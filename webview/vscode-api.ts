/**
 * Webview ⇄ extension host bridge. The extension always runs inside a
 * VS Code custom editor, so `acquireVsCodeApi()` is guaranteed to exist.
 */

declare function acquireVsCodeApi(): {
  postMessage(msg: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
};

interface VsCodeApi {
  postMessage(msg: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
}

const KEY = "__BTRMK_VSCODE_API__";

export const vscodeApi: VsCodeApi = (() => {
  const w = window as any;
  if (w[KEY]) return w[KEY];
  const api = acquireVsCodeApi();
  w[KEY] = api;
  return api;
})();
