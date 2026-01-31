import type * as vscode from 'vscode';
import type { Config } from './config';

// Subset of vscode API used by handler. Enables testing with mocks.
export interface VSCodeAPI {
  commands: {
    executeCommand<T>(command: string, ...args: unknown[]): Thenable<T | undefined>;
  };
  workspace: {
    workspaceFolders: readonly { uri: { fsPath: string } }[] | undefined;
    openTextDocument(uri: vscode.Uri): Thenable<vscode.TextDocument>;
    getConfiguration(section: string): {
      get<T>(key: string, defaultValue: T): T;
    };
  };
  window: {
    showTextDocument(document: vscode.TextDocument): Thenable<vscode.TextEditor>;
    showErrorMessage(message: string): Thenable<string | undefined>;
    showQuickPick<T extends vscode.QuickPickItem>(
      items: T[],
      options?: vscode.QuickPickOptions
    ): Thenable<T | undefined>;
  };
  Uri: {
    file(path: string): vscode.Uri;
  };
  SymbolKind: typeof vscode.SymbolKind;
}

export interface HandlerDeps {
  vscode: VSCodeAPI;
  getConfig: () => Config;
}

function parseSymbolKind(
  kind: string,
  SymbolKind: typeof vscode.SymbolKind
): vscode.SymbolKind | undefined {
  const kindMap: Record<string, vscode.SymbolKind> = {
    File: SymbolKind.File,
    Module: SymbolKind.Module,
    Namespace: SymbolKind.Namespace,
    Package: SymbolKind.Package,
    Class: SymbolKind.Class,
    Method: SymbolKind.Method,
    Property: SymbolKind.Property,
    Field: SymbolKind.Field,
    Constructor: SymbolKind.Constructor,
    Enum: SymbolKind.Enum,
    Interface: SymbolKind.Interface,
    Function: SymbolKind.Function,
    Variable: SymbolKind.Variable,
    Constant: SymbolKind.Constant,
    String: SymbolKind.String,
    Number: SymbolKind.Number,
    Boolean: SymbolKind.Boolean,
    Array: SymbolKind.Array,
    Object: SymbolKind.Object,
    Key: SymbolKind.Key,
    Null: SymbolKind.Null,
    EnumMember: SymbolKind.EnumMember,
    Struct: SymbolKind.Struct,
    Event: SymbolKind.Event,
    Operator: SymbolKind.Operator,
    TypeParameter: SymbolKind.TypeParameter,
  };
  return kindMap[kind];
}

export function createHandler(deps: HandlerDeps) {
  const { vscode, getConfig } = deps;

  async function resolveSymbol(
    symbolName: string,
    kind?: string
  ): Promise<vscode.Location | undefined> {
    const config = getConfig();

    // LSP may not be ready immediately after workspace opens. Retry until indexed.
    for (let i = 0; i < config.retryCount; i++) {
      let symbols = await vscode.commands.executeCommand<vscode.SymbolInformation[]>(
        'vscode.executeWorkspaceSymbolProvider',
        symbolName
      );

      if (symbols && symbols.length > 0) {
        // LSP returns fuzzy matches (e.g. "Setup" matches "SetupAuthorize"). Filter to exact.
        symbols = symbols.filter(s => s.name === symbolName);

        if (kind) {
          const kindEnum = parseSymbolKind(kind, vscode.SymbolKind);
          if (kindEnum !== undefined) {
            symbols = symbols.filter(s => s.kind === kindEnum);
          }
        }

        if (symbols.length > 0) {
          return selectSymbol(symbols, config);
        }
      }

      await new Promise(resolve => setTimeout(resolve, config.retryInterval));
    }

    return undefined;
  }

  async function selectSymbol(
    symbols: vscode.SymbolInformation[],
    config: Config
  ): Promise<vscode.Location | undefined> {
    if (symbols.length === 0) {
      return undefined;
    }

    if (symbols.length === 1 || config.multipleSymbolBehavior === 'first') {
      return symbols[0].location;
    }

    if (config.multipleSymbolBehavior === 'quickpick') {
      const items = symbols.map(s => ({
        label: s.name,
        description: s.containerName,
        detail: s.location.uri.fsPath,
        symbol: s,
      }));

      const selected = await vscode.window.showQuickPick(items, {
        placeHolder: 'Select a symbol',
      });

      return selected?.symbol.location;
    }

    if (config.multipleSymbolBehavior === 'workspace-priority') {
      // Iterate workspace folders in user-defined order (first folder = highest priority).
      // Return first symbol found in any workspace folder. Falls back to first result
      // if symbol exists only in external dependencies (node_modules, vendor, etc.).
      const workspaceFolders = vscode.workspace.workspaceFolders;
      if (workspaceFolders) {
        for (const folder of workspaceFolders) {
          const match = symbols.find(s =>
            s.location.uri.fsPath.startsWith(folder.uri.fsPath)
          );
          if (match) {
            return match.location;
          }
        }
      }
      return symbols[0].location;
    }

    return symbols[0].location;
  }

  async function handleUri(uri: vscode.Uri): Promise<void> {
    const params = new URLSearchParams(uri.query);
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
    const isWorkspaceOpen = workspaceFolders?.some(
      folder => folder.uri.fsPath === cwd
    );

    if (!isWorkspaceOpen) {
      const folderUri = vscode.Uri.file(cwd);

      if (config.workspaceNotOpenBehavior === 'error') {
        await vscode.window.showErrorMessage(
          `Workspace "${cwd}" is not open. Please open it first.`
        );
        return;
      }

      // Opening folder triggers extension reload. The new window receives the same URI,
      // so handleUri runs again with workspace now open.
      await vscode.commands.executeCommand('vscode.openFolder', folderUri, {
        forceNewWindow: config.workspaceNotOpenBehavior === 'new-window',
      });
      return;
    }

    const location = await resolveSymbol(symbol, kind);
    if (location) {
      const document = await vscode.workspace.openTextDocument(location.uri);
      await vscode.window.showTextDocument(document);
    } else {
      const kindInfo = kind ? ` (kind: ${kind})` : '';
      await vscode.window.showErrorMessage(
        `Symbol "${symbol}"${kindInfo} not found in workspace`
      );
    }
  }

  return { handleUri, resolveSymbol };
}
