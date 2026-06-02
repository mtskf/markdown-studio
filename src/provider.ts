import * as vscode from "vscode";
import * as path from "path";
import { SETTING_KEYS } from "../webview/settings";

const CONFIG_NAMESPACE = "markdownStudio";
const CURSORS_KEY = "betterMarkdown.cursors";
const HEADING_FOLDS_KEY = "betterMarkdown.headingFolds";
const TOC_COLLAPSED_KEY = "betterMarkdown.tocCollapsed";
const CONSENT_SHOWN_KEY = "betterMarkdown.consentShown";

/**
 * Read every known setting from VS Code config into a plain object the
 * webview can fold into `mergeSettings()`. Reading per-key (instead of
 * `config.get` on the whole namespace) keeps the payload limited to keys
 * we actually own — drive-by entries from other extensions or stale
 * configs don't leak through.
 */
function readSettings(): Record<string, unknown> {
  const config = vscode.workspace.getConfiguration(CONFIG_NAMESPACE);
  const out: Record<string, unknown> = {};
  for (const key of SETTING_KEYS) {
    const value = config.get(key);
    if (value !== undefined) out[key] = value;
  }
  return out;
}

/**
 * Persist a settings payload from the webview's in-app panel by writing
 * each changed key to User scope. We diff against the current effective
 * value to avoid kicking off 16 `onDidChangeConfiguration` events when
 * only one toggle moved.
 */
async function writeSettings(next: Record<string, unknown>): Promise<void> {
  const config = vscode.workspace.getConfiguration(CONFIG_NAMESPACE);
  for (const key of SETTING_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(next, key)) continue;
    const incoming = next[key];
    if (config.get(key) === incoming) continue;
    await config.update(key, incoming, vscode.ConfigurationTarget.Global);
  }
}

export class BetterMarkdownProvider implements vscode.CustomTextEditorProvider {
  constructor(readonly context: vscode.ExtensionContext) {
    this.context.subscriptions.push(
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (!e.affectsConfiguration(CONFIG_NAMESPACE)) return;
        const settings = readSettings();
        for (const wv of this.openWebviews) {
          wv.postMessage({ type: "settingsUpdated", settings });
        }
      }),
    );
  }

  private activeWebview: vscode.Webview | null = null;
  private openWebviews = new Set<vscode.Webview>();

  openSearch() {
    this.activeWebview?.postMessage({ type: "openSearch" });
  }

  private loadCursor(filePath: string): number | undefined {
    const all =
      this.context.globalState.get<Record<string, number>>(CURSORS_KEY, {}) ??
      {};
    return all[filePath];
  }

  private async saveCursor(filePath: string, position: number): Promise<void> {
    const all =
      this.context.globalState.get<Record<string, number>>(CURSORS_KEY, {}) ??
      {};
    all[filePath] = position;
    await this.context.globalState.update(CURSORS_KEY, all);
  }

  /**
   * Folded-heading indices keyed per file. Index-based (same scheme as the
   * TOC and StickyHeadings) — survives a file reload but not heading
   * insertion/removal above the saved index. Round-trip markdown is
   * untouched; this state lives only in globalState.
   */
  private loadHeadingFolds(filePath: string): number[] {
    const all =
      this.context.globalState.get<Record<string, number[]>>(
        HEADING_FOLDS_KEY,
        {},
      ) ?? {};
    return all[filePath] ?? [];
  }

  private async saveHeadingFolds(
    filePath: string,
    folds: number[],
  ): Promise<void> {
    const all =
      this.context.globalState.get<Record<string, number[]>>(
        HEADING_FOLDS_KEY,
        {},
      ) ?? {};
    if (folds.length === 0) {
      delete all[filePath];
    } else {
      all[filePath] = folds;
    }
    await this.context.globalState.update(HEADING_FOLDS_KEY, all);
  }

  /**
   * Last-known collapsed state of the TOC sidebar. Stored globally (not
   * per-file) — the TOC is a UI affordance the user toggles once and
   * expects to stay put across files. Returns `undefined` on first run so
   * the webview can apply its initial default (collapsed) without
   * conflating "never set" with "explicitly false".
   */
  private loadTocCollapsed(): boolean | undefined {
    return this.context.globalState.get<boolean>(TOC_COLLAPSED_KEY);
  }

  private async saveTocCollapsed(value: boolean): Promise<void> {
    await this.context.globalState.update(TOC_COLLAPSED_KEY, value);
  }

  /**
   * Setup prompt fired the first time the rich editor opens any file
   * post-install, and re-runnable via the `Markdown Studio: Open Setup
   * Prompt` command. The actual UI is rendered inside the webview (see
   * `SetupPrompt.tsx`); this method just routes the trigger to the right
   * webview. The webview posts `setupPromptChoice` back, which is
   * handled by `applySetupChoice` below.
   */
  showFirstRunConsent(webview?: vscode.Webview): void {
    const target = webview ?? this.activeWebview;
    if (target) {
      target.postMessage({ type: "showSetupPrompt" });
      return;
    }
    // Manual command path with no markdown file open — the in-webview
    // prompt has nowhere to render. Tell the user to open a file and
    // re-run, since the on-open path will fire automatically next time.
    vscode.window.showInformationMessage(
      "Open a markdown file in the rich editor to access Markdown Studio setup.",
    );
  }

  /**
   * Apply the user's setup-prompt choice. Called from the webview
   * message handler when `setupPromptChoice` arrives. Records consent so
   * the on-open prompt doesn't re-fire. The webview opens its own
   * settings panel for `review` directly, so no host action needed.
   */
  async applySetupChoice(_choice: string): Promise<void> {
    await this.context.globalState.update(CONSENT_SHOWN_KEY, true);
  }

  /**
   * Wipe all Markdown Studio user settings + the first-run consent flag,
   * so settings revert to defaults and the welcome modal fires again on
   * the next file open. Confirms before nuking so a stray click in the
   * command palette doesn't cost the user their configuration. Clears
   * every key from User scope; workspace overrides (if any) are left
   * alone so per-repo settings still apply.
   */
  async factoryReset(): Promise<void> {
    const RESET = "Reset";
    const choice = await vscode.window.showWarningMessage(
      "Factory reset Markdown Studio? All settings revert to defaults.",
      { modal: true },
      RESET,
    );
    if (choice !== RESET) return;

    const config = vscode.workspace.getConfiguration(CONFIG_NAMESPACE);
    for (const key of SETTING_KEYS) {
      await config.update(key, undefined, vscode.ConfigurationTarget.Global);
    }
    await this.context.globalState.update(CONSENT_SHOWN_KEY, undefined);

    // The onDidChangeConfiguration listener above will broadcast the
    // post-reset values to every open webview.

    vscode.window.showInformationMessage(
      "Markdown Studio: factory reset complete. Open any markdown file to see the welcome prompt.",
    );
  }

  /**
   * Fetch the HEAD version of a file via VSCode's built-in git extension.
   * Returns null if git isn't available, the file isn't tracked, or the ref
   * doesn't exist (e.g. new file).
   */
  private async getHeadContent(fileUri: vscode.Uri): Promise<string | null> {
    try {
      const gitExt = vscode.extensions.getExtension("vscode.git");
      if (!gitExt) return null;
      if (!gitExt.isActive) await gitExt.activate();
      // The git extension API is un-typed in @types/vscode — loose typing.
      const gitApi = (gitExt.exports as any).getAPI(1);
      if (!gitApi) return null;
      const repo = gitApi.repositories.find((r: any) =>
        fileUri.fsPath.startsWith(r.rootUri.fsPath),
      );
      if (!repo) return null;
      // Empty ref ('') = staged, 'HEAD' = committed. We want HEAD.
      const head = await repo.show("HEAD", fileUri.fsPath);
      return typeof head === "string" ? head : null;
    } catch {
      return null;
    }
  }

  async resolveCustomTextEditor(
    document: vscode.TextDocument,
    webviewPanel: vscode.WebviewPanel,
    _token: vscode.CancellationToken,
  ): Promise<void> {
    const webview = webviewPanel.webview;

    // Non-file schemes (git:, conflictResolution:, vscode-scm:, ...) are read-
    // only. We still render them — e.g. git diff side panes get the rich
    // Tiptap view — but we suppress edit sync so we never try to write back.
    const isReadonly = document.uri.scheme !== "file";

    // Allow loading resources from the document's folder (for images)
    const docFolder = vscode.Uri.joinPath(document.uri, "..");
    webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this.context.extensionUri, "dist"),
        docFolder,
        ...(vscode.workspace.workspaceFolders?.map((f) => f.uri) || []),
      ],
    };

    // Base URI for resolving relative image paths in webview
    const baseUri = webview.asWebviewUri(docFolder).toString();
    // Raw filesystem path of the document's folder (for restoring relative paths on save)
    const docFolderPath = docFolder.fsPath;

    let pendingWebviewEdits = 0;
    // Snapshot of the last content we posted to the webview. Lets the
    // view-state resync below skip no-op updates and avoids re-pushing
    // content the webview already has.
    let lastSentContent = document.getText();

    // The first edit the webview emits after init is the normalization
    // round-trip (md → html → md). We save it silently so users don't see
    // a surprise dirty state on open, then hand off: every subsequent edit
    // follows VS Code's own save behavior (`files.autoSave`, Cmd+S, etc.)
    // so we don't fight the user's configured save cadence.
    let firstEditPending = true;

    // First-run consent: the very first file opened post-install must not
    // be silently rewritten before the user has chosen how to handle
    // normalization. Snapshot the flag at start so a "Disable all" choice
    // mid-session still suppresses this open's silent save.
    const consentShownAtStart =
      this.context.globalState.get<boolean>(CONSENT_SHOWN_KEY) === true;

    this.openWebviews.add(webview);

    const msgDisposable = webview.onDidReceiveMessage(async (msg) => {
      if (msg.type === "ready") {
        lastSentContent = document.getText();
        webview.postMessage({
          type: "init",
          content: lastSentContent,
          baseUri,
          docFolderPath,
          filePath: document.uri.fsPath,
          isReadonly,
          settings: readSettings(),
          cursorPosition: this.loadCursor(document.uri.fsPath),
          headingFolds: this.loadHeadingFolds(document.uri.fsPath),
          tocCollapsed: this.loadTocCollapsed(),
        });
        // Fire the first-run setup prompt only after the webview has
        // signalled `ready` — posting earlier would land before the
        // message listener is attached and the message would be lost.
        if (!consentShownAtStart) {
          this.showFirstRunConsent(webview);
        }
      } else if (msg.type === "saveCursor") {
        if (
          typeof msg.position === "number" &&
          document.uri.scheme === "file"
        ) {
          await this.saveCursor(document.uri.fsPath, msg.position);
        }
      } else if (msg.type === "saveHeadingFolds") {
        if (Array.isArray(msg.folds) && document.uri.scheme === "file") {
          const folds = (msg.folds as unknown[]).filter(
            (n): n is number => typeof n === "number" && Number.isInteger(n),
          );
          await this.saveHeadingFolds(document.uri.fsPath, folds);
        }
      } else if (msg.type === "saveTocCollapsed") {
        if (typeof msg.collapsed === "boolean") {
          await this.saveTocCollapsed(msg.collapsed);
        }
      } else if (msg.type === "saveSettings") {
        await writeSettings(msg.settings as Record<string, unknown>);
      } else if (msg.type === "setupPromptChoice") {
        await this.applySetupChoice(msg.choice as string);
      } else if (msg.type === "requestGitDiff") {
        let headContent: string | null = null;
        if (document.uri.scheme === "file") {
          headContent = await this.getHeadContent(document.uri);
        }
        webview.postMessage({
          type: "gitDiffResponse",
          headContent,
          fileName: path.basename(document.uri.fsPath),
        });
      } else if (msg.type === "toggleEditor") {
        vscode.commands.executeCommand(
          "vscode.openWith",
          document.uri,
          "default",
        );
      } else if (msg.type === "openLink") {
        const href = msg.href as string;
        if (href.startsWith("http://") || href.startsWith("https://")) {
          vscode.env.openExternal(vscode.Uri.parse(href));
        } else {
          // Relative link — resolve against the document's folder
          const docDir = path.dirname(document.uri.fsPath);
          const targetPath = path.resolve(docDir, href);
          const targetUri = vscode.Uri.file(targetPath);
          try {
            await vscode.commands.executeCommand("vscode.open", targetUri);
          } catch {
            // If file doesn't exist, ignore
          }
        }
      } else if (msg.type === "promptImageUrl") {
        const url = await vscode.window.showInputBox({
          prompt: "Image URL",
          placeHolder: "https://example.com/image.png",
        });
        webview.postMessage({ type: "imageUrlResult", url: url || null });
      } else if (msg.type === "uploadImage") {
        try {
          const data = Buffer.from(msg.data as string, "base64");
          const requested = path.basename(msg.filename as string);
          // Find unique filename
          let finalName = requested;
          let counter = 1;
          while (true) {
            const dest = vscode.Uri.file(path.join(docFolderPath, finalName));
            try {
              await vscode.workspace.fs.stat(dest);
              const ext = path.extname(requested);
              const base = path.basename(requested, ext);
              finalName = `${base}-${counter}${ext}`;
              counter++;
            } catch {
              break; // doesn't exist, use this name
            }
          }
          const destUri = vscode.Uri.file(path.join(docFolderPath, finalName));
          await vscode.workspace.fs.writeFile(destUri, data);
          webview.postMessage({
            type: "imageUploaded",
            src: `${baseUri}/${finalName}`,
          });
        } catch (err: any) {
          webview.postMessage({ type: "imageUploaded", src: null });
        }
      } else if (msg.type === "edit") {
        if (isReadonly) return;
        const newContent = msg.content as string;
        if (newContent === document.getText()) return;
        pendingWebviewEdits++;
        const edit = new vscode.WorkspaceEdit();
        edit.replace(
          document.uri,
          new vscode.Range(0, 0, document.lineCount, 0),
          newContent,
        );
        await vscode.workspace.applyEdit(edit);
        lastSentContent = newContent;
        if (firstEditPending) {
          firstEditPending = false;
          const autoSave = vscode.workspace
            .getConfiguration(CONFIG_NAMESPACE)
            .get<boolean>("autoSave", true);
          if (consentShownAtStart && autoSave) {
            try {
              await document.save();
            } catch {
              // Transient save failures (read-only FS, permission) leave
              // the doc dirty; the user can retry with Cmd+S.
            }
          }
        }
      }
    });

    webview.html = this.getHtmlForWebview(webview);

    // Track active webview for search command
    if (webviewPanel.active) this.activeWebview = webview;
    webviewPanel.onDidChangeViewState(() => {
      if (webviewPanel.active) this.activeWebview = webview;
      // Re-sync on becoming visible. External edits (git pull, peer
      // editors, format-on-save extensions) can update the document
      // while the webview is hidden — VS Code may drop `postMessage`s
      // sent to a non-visible webview, so the docChange handler
      // intentionally does not advance `lastSentContent` for hidden
      // posts. Comparing against `lastSentContent` skips no-op posts,
      // and the `pendingWebviewEdits` guard avoids echoing the
      // webview's own in-flight edit back to it.
      if (!webviewPanel.visible) return;
      if (pendingWebviewEdits > 0) return;
      const current = document.getText();
      if (current === lastSentContent) return;
      lastSentContent = current;
      webview.postMessage({ type: "update", content: current });
    });

    const docChangeDisposable = vscode.workspace.onDidChangeTextDocument(
      (e) => {
        if (e.document.uri.toString() !== document.uri.toString()) return;
        if (e.contentChanges.length === 0) return;

        if (pendingWebviewEdits > 0) {
          pendingWebviewEdits--;
          return;
        }

        const current = document.getText();
        webview.postMessage({
          type: "update",
          content: current,
        });
        // Only advance the snapshot when we know the post can land — for
        // a hidden webview the message may be dropped, and advancing
        // would cause the view-state resync to incorrectly see no drift
        // when the panel becomes visible, leaving the editor stale.
        if (webviewPanel.visible) {
          lastSentContent = current;
        }
      },
    );

    webviewPanel.onDidDispose(() => {
      msgDisposable.dispose();
      docChangeDisposable.dispose();
      this.openWebviews.delete(webview);
    });
  }

  private getHtmlForWebview(webview: vscode.Webview): string {
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, "dist", "webview.js"),
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, "dist", "editor.css"),
    );
    const nonce = getNonce();

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}' ${webview.cspSource} 'wasm-unsafe-eval'; font-src ${webview.cspSource} data:; img-src ${webview.cspSource} data: blob: https:;">
  <link href="${styleUri}" rel="stylesheet">
  <title>Markdown Studio</title>
</head>
<body>
  <div id="root"></div>
  <script nonce="${nonce}" type="module" src="${scriptUri}"></script>
</body>
</html>`;
  }
}

function getNonce(): string {
  let text = "";
  const possible =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}
