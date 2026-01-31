import * as vscode from 'vscode';

// 'first': Use the first match. Fast, but may open wrong symbol if duplicates exist.
// 'quickpick': Show picker when multiple matches. Interactive but interrupts flow.
// 'workspace-priority': Prefer symbols in current workspace folders (in order).
//   Iterates workspace folders and returns first symbol whose path starts with folder path.
//   Useful for monorepos where same symbol name exists in multiple packages.
export type MultipleSymbolBehavior = 'first' | 'quickpick' | 'workspace-priority';

// 'new-window': Open workspace in new window, URI handler re-triggers in new window.
// 'current-window': Replace current workspace. Loses current context.
// 'error': Show error, require user to open workspace manually first.
export type WorkspaceNotOpenBehavior = 'new-window' | 'current-window' | 'error';

export interface Config {
  multipleSymbolBehavior: MultipleSymbolBehavior;
  workspaceNotOpenBehavior: WorkspaceNotOpenBehavior;
  retryCount: number;
  retryInterval: number;
}

export function getConfig(): Config {
  const config = vscode.workspace.getConfiguration('symbolOpener');
  return {
    multipleSymbolBehavior: config.get<MultipleSymbolBehavior>('multipleSymbolBehavior', 'first'),
    workspaceNotOpenBehavior: config.get<WorkspaceNotOpenBehavior>('workspaceNotOpenBehavior', 'new-window'),
    // LSP servers need time to index after workspace opens.
    retryCount: config.get<number>('retryCount', 5),
    retryInterval: config.get<number>('retryInterval', 500),
  };
}
