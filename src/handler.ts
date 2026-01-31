import type * as vscode from 'vscode';
import type { Config, LangDetector, Logger } from './config';
import type { VSCodeAPI } from './vscode-api';

export interface HandlerDeps {
  vscode: VSCodeAPI;
  getConfig: () => Config;
  logger: Logger;
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
  const { vscode, getConfig, logger } = deps;

  // Query transforms to try for workspace symbol search.
  // TypeScript LSP requires # prefix; others work with plain name.
  const queryTransforms = [
    (name: string) => `#${name}`,
    (name: string) => name,
  ];

  async function findSymbols(
    symbolName: string
  ): Promise<vscode.SymbolInformation[]> {
    for (const transform of queryTransforms) {
      const query = transform(symbolName);
      const symbols = await vscode.commands.executeCommand<vscode.SymbolInformation[]>(
        'vscode.executeWorkspaceSymbolProvider',
        query
      );
      logger.debug(`query="${query}", results=${symbols?.length ?? 0}`);
      if (symbols && symbols.length > 0) {
        return symbols;
      }
    }
    return [];
  }

  async function tryResolveSymbol(
    symbolName: string,
    kind?: string
  ): Promise<vscode.SymbolInformation | undefined> {
    let symbols = await findSymbols(symbolName);
    if (symbols.length === 0) {
      return undefined;
    }

    logger.debug(`raw results: ${JSON.stringify(symbols.map(s => ({ name: s.name, kind: s.kind })))}`);

    // LSP returns fuzzy matches and may append () for functions. Filter to exact base name.
    symbols = symbols.filter(s => {
      const baseName = s.name.replace(/\(\)$/, '');
      return baseName === symbolName;
    });

    if (kind) {
      const kindEnum = parseSymbolKind(kind, vscode.SymbolKind);
      if (kindEnum !== undefined) {
        symbols = symbols.filter(s => s.kind === kindEnum);
      }
    }

    if (symbols.length === 0) {
      return undefined;
    }

    return selectSymbol(symbols, getConfig());
  }

  async function resolveSymbol(
    symbolName: string,
    kind?: string
  ): Promise<vscode.SymbolInformation | undefined> {
    const config = getConfig();

    // LSP may not be ready immediately after workspace opens. Retry until indexed.
    for (let attempt = 0; attempt < config.retryCount; attempt++) {
      logger.debug(`attempt ${attempt + 1}/${config.retryCount}`);

      const symbol = await tryResolveSymbol(symbolName, kind);
      if (symbol) {
        return symbol;
      }

      await new Promise(resolve => setTimeout(resolve, config.retryInterval));
    }

    return undefined;
  }

  async function selectSymbol(
    symbols: vscode.SymbolInformation[],
    config: Config
  ): Promise<vscode.SymbolInformation | undefined> {
    if (symbols.length === 0) {
      return undefined;
    }

    if (symbols.length === 1 || config.multipleSymbolBehavior === 'first') {
      return symbols[0];
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

      return selected?.symbol;
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
            return match;
          }
        }
      }
      return symbols[0];
    }

    return symbols[0];
  }

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

      // Opening folder triggers extension reload. The new window receives the same URI,
      // so handleUri runs again with workspace now open.
      await vscode.commands.executeCommand('vscode.openFolder', folderUri, {
        forceNewWindow: config.workspaceNotOpenBehavior === 'new-window',
      });
      return;
    }

    // Detect language from project files and open a source file to trigger LSP
    await activateLsp(config.langDetectors);

    logger.info(`resolving symbol: ${symbol}${kind ? `, kind: ${kind}` : ''}`);
    const resolved = await resolveSymbol(symbol, kind);
    if (resolved) {
      const { location } = resolved;
      logger.info(`found: ${location.uri.fsPath}:${location.range.start.line}`);
      const document = await vscode.workspace.openTextDocument(location.uri);
      const editor = await vscode.window.showTextDocument(document);
      editor.selection = new vscode.Selection(location.range.start, location.range.start);
      editor.revealRange(location.range, vscode.TextEditorRevealType.InCenter);
    } else {
      logger.info('not found');
      const kindInfo = kind ? ` (kind: ${kind})` : '';
      await vscode.window.showErrorMessage(
        `Symbol "${symbol}"${kindInfo} not found in workspace`
      );
    }
  }

  async function activateLsp(langDetectors: LangDetector[]): Promise<void> {
    for (const { markers, glob, exclude } of langDetectors) {
      for (const marker of markers) {
        const markerFiles = await vscode.workspace.findFiles(marker, undefined, 1);
        if (markerFiles && markerFiles.length > 0) {
          const sourceFiles = await vscode.workspace.findFiles(glob, exclude, 1);
          if (sourceFiles && sourceFiles.length > 0) {
            // openTextDocument loads the file without showing it in the editor
            await vscode.workspace.openTextDocument(sourceFiles[0]);
            logger.debug(`detected ${marker}, opened ${sourceFiles[0].fsPath} to trigger LSP`);
          }
          return;
        }
      }
    }
  }

  return { handleUri, resolveSymbol };
}
