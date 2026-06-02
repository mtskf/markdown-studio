import * as vscode from "vscode";
import { SETTING_KEYS } from "../webview/settings";

export { SETTING_KEYS };

export const CONFIG_NAMESPACE = "markdownStudio";

/**
 * Read every known setting from VS Code config into a plain object the
 * webview can fold into `mergeSettings()`. Reading per-key (instead of
 * `config.get` on the whole namespace) keeps the payload limited to keys
 * we actually own — drive-by entries from other extensions or stale
 * configs don't leak through.
 */
export function readSettings(): Record<string, unknown> {
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
export async function writeSettings(
  next: Record<string, unknown>,
): Promise<void> {
  const config = vscode.workspace.getConfiguration(CONFIG_NAMESPACE);
  for (const key of SETTING_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(next, key)) continue;
    const incoming = next[key];
    if (config.get(key) === incoming) continue;
    await config.update(key, incoming, vscode.ConfigurationTarget.Global);
  }
}
