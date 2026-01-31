import type * as vscode from 'vscode';
import type { GlobalState, PendingUri } from './vscode-api';
export type { PendingUri };
import { createSymbolResolver, SymbolResolverDeps } from './symbol-resolver';

export interface HandlerDeps extends SymbolResolverDeps {
  globalState?: GlobalState;
}

const PENDING_URI_KEY = 'pendingUri';

export function createHandler(deps: HandlerDeps) {
  const { vscode, getConfig, logger, globalState } = deps;
  const { openSymbol } = createSymbolResolver(deps);

  async function handleUri(uri: vscode.Uri): Promise<void> {
    // macOS open command double-encodes the query string
    const decoded = decodeURIComponent(uri.query);
    const params = new URLSearchParams(decoded);
    const symbol = params.get('symbol');
    const cwd = params.get('cwd');
    const kind = params.get('kind') ?? undefined;

    if (!symbol || !cwd) {
      await vscode.window.showErrorMessage(
        'Symbol Opener: Missing required parameters (symbol, cwd)'
      );
      return;
    }

    const config = getConfig();
    const workspaceFolders = vscode.workspace.workspaceFolders;
    logger.debug(`workspaceFolders: ${JSON.stringify(workspaceFolders?.map(f => f.uri.fsPath))}`);
    logger.debug(`cwd: ${cwd}`);
    const isWorkspaceOpen = workspaceFolders?.some(
      folder => folder.uri.fsPath === cwd
    );
    logger.debug(`isWorkspaceOpen: ${isWorkspaceOpen}`);

    if (!isWorkspaceOpen) {
      const folderUri = vscode.Uri.file(cwd);

      if (config.workspaceNotOpenBehavior === 'error') {
        await vscode.window.showErrorMessage(
          `Workspace "${cwd}" is not open. Please open it first.`
        );
        return;
      }

      // Save URI params to globalState so the new window can process it on startup
      if (globalState) {
        const pendingUri: PendingUri = { symbol, cwd, kind };
        await globalState.update(PENDING_URI_KEY, pendingUri);
        logger.debug(`saved pending URI: ${JSON.stringify(pendingUri)}`);
      }

      await vscode.commands.executeCommand('vscode.openFolder', folderUri, {
        forceNewWindow: config.workspaceNotOpenBehavior === 'new-window',
      });
      return;
    }

    await openSymbol(symbol, kind);
  }

  // Called on extension activation to handle URIs saved by another window.
  // When a URI targets a workspace not open in the current window, handleUri saves
  // the URI params to globalState and opens the workspace in a new window.
  // This function runs in the new window to complete the symbol resolution.
  async function processPendingUri(): Promise<void> {
    if (!globalState) {
      return;
    }

    const pending = globalState.get<PendingUri>(PENDING_URI_KEY);
    if (!pending) {
      return;
    }

    const { symbol, cwd, kind } = pending;
    logger.debug(`found pending URI: ${JSON.stringify(pending)}`);

    // Only process if this window has the target workspace open.
    // Other windows may also receive onStartupFinished, so we skip if cwd doesn't match.
    const workspaceFolders = vscode.workspace.workspaceFolders;
    const isWorkspaceOpen = workspaceFolders?.some(
      folder => folder.uri.fsPath === cwd
    );

    if (!isWorkspaceOpen) {
      logger.debug(`cwd ${cwd} not in current workspace, skipping`);
      return;
    }

    await globalState.update(PENDING_URI_KEY, undefined);
    logger.debug('cleared pending URI');

    await openSymbol(symbol, kind);
  }

  return { handleUri, processPendingUri };
}
