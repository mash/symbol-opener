import type * as vscode from 'vscode';
import type { Config, LangDetector, Logger } from './config';
import type { VSCodeAPI } from './vscode-api';
import { parseSymbolKind, buildKindNameToEnum } from './symbol-kind';

// Sorts symbols by SymbolKind priority.
// Priority array index determines sort order: index 0 = highest priority.
// Kinds not in priority list are sorted to the end.
export function sortByKindPriority(
  symbols: vscode.SymbolInformation[],
  priority: string[],
  SymbolKind: typeof vscode.SymbolKind
): vscode.SymbolInformation[] {
  const kindNameToEnum = buildKindNameToEnum(SymbolKind);

  const priorityMap = new Map<number, number>();
  for (const name of priority) {
    const kind = kindNameToEnum[name];
    if (kind === undefined) {
      throw new Error(`Invalid SymbolKind in symbolSortPriority: "${name}"`);
    }
    priorityMap.set(kind, priorityMap.size);
  }

  return [...symbols].sort((a, b) => {
    const aPriority = priorityMap.get(a.kind) ?? Infinity;
    const bPriority = priorityMap.get(b.kind) ?? Infinity;
    return aPriority - bPriority;
  });
}

export interface SymbolResolverDeps {
  vscode: VSCodeAPI;
  getConfig: () => Config;
  logger: Logger;
}

interface ResolveResult {
  symbol?: vscode.SymbolInformation;
  fuzzyMatches: vscode.SymbolInformation[];
  cancelled?: boolean;
}

export function createSymbolResolver(deps: SymbolResolverDeps) {
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
  ): Promise<ResolveResult> {
    const symbols = await findSymbols(symbolName);
    if (symbols.length === 0) {
      return { fuzzyMatches: [] };
    }

    logger.debug(`raw results: ${JSON.stringify(symbols.map(s => ({ name: s.name, kind: s.kind })))}`);

    // LSP returns fuzzy matches. Normalize names before comparing:
    // - TypeScript appends () for functions: createHandler() → createHandler
    // - Go prefixes type for methods: Linker.buildSymbolPattern → buildSymbolPattern
    let exactMatches = symbols.filter(s => {
      let name = s.name.replace(/\(\)$/, '');
      const dotIndex = name.lastIndexOf('.');
      if (dotIndex !== -1) {
        name = name.substring(dotIndex + 1);
      }
      return name === symbolName;
    });

    if (kind) {
      const kindEnum = parseSymbolKind(kind, vscode.SymbolKind);
      if (kindEnum !== undefined) {
        exactMatches = exactMatches.filter(s => s.kind === kindEnum);
      }
    }

    if (exactMatches.length > 0) {
      const symbol = await selectSymbol(exactMatches, getConfig());
      if (!symbol) {
        return { cancelled: true, fuzzyMatches: [] };
      }
      return { symbol, fuzzyMatches: [] };
    }

    // No exact match, return symbols as fuzzy matches (filtered by kind if specified)
    let fuzzyMatches = symbols;
    if (kind) {
      const kindEnum = parseSymbolKind(kind, vscode.SymbolKind);
      if (kindEnum !== undefined) {
        fuzzyMatches = fuzzyMatches.filter(s => s.kind === kindEnum);
      }
    }
    return { fuzzyMatches };
  }

  async function resolveSymbol(
    symbolName: string,
    kind?: string
  ): Promise<{ symbol?: vscode.SymbolInformation; cancelled?: boolean }> {
    const config = getConfig();

    return vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Window,
        title: `Looking for symbol "${symbolName}"`,
        cancellable: true,
      },
      async (progress, token) => {
        // LSP may not be ready immediately after workspace opens. Retry until indexed.
        for (let attempt = 0; attempt < config.retryCount; attempt++) {
          if (token.isCancellationRequested) {
            return { cancelled: true };
          }

          logger.debug(`attempt ${attempt + 1}/${config.retryCount}`);
          progress.report({ message: `(${attempt + 1}/${config.retryCount})` });

          const result = await tryResolveSymbol(symbolName, kind);
          if (result.cancelled) {
            return { cancelled: true };
          }
          if (result.symbol) {
            return { symbol: result.symbol };
          }

          if (result.fuzzyMatches.length > 0) {
            const selected = await selectFuzzyMatch(result.fuzzyMatches);
            if (!selected) {
              return { cancelled: true };
            }
            return { symbol: selected };
          }

          await new Promise(resolve => setTimeout(resolve, config.retryInterval));
        }

        return {};
      }
    );
  }

  async function selectFuzzyMatch(
    symbols: vscode.SymbolInformation[]
  ): Promise<vscode.SymbolInformation | undefined> {
    const items = symbols.map(s => ({
      label: s.name,
      description: s.containerName,
      detail: s.location.uri.fsPath,
      symbol: s,
    }));

    const selected = await vscode.window.showQuickPick(items, {
      placeHolder: 'No exact match found. Select a similar symbol:',
    });

    return selected?.symbol;
  }

  async function selectSymbol(
    symbols: vscode.SymbolInformation[],
    config: Config
  ): Promise<vscode.SymbolInformation | undefined> {
    if (symbols.length === 0) {
      return undefined;
    }

    const sorted = sortByKindPriority(symbols, config.symbolSortPriority, vscode.SymbolKind);

    if (sorted.length === 1 || config.multipleSymbolBehavior === 'first') {
      return sorted[0];
    }

    if (config.multipleSymbolBehavior === 'quickpick') {
      const items = sorted.map(s => ({
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

    return sorted[0];
  }

  async function activateLsp(langDetectors: LangDetector[], language?: string): Promise<void> {
    // If language is explicitly configured, use that detector directly
    if (language) {
      const detector = langDetectors.find(d => d.lang === language);
      if (detector) {
        const sourceFiles = await vscode.workspace.findFiles(detector.glob, detector.exclude, 1);
        if (sourceFiles && sourceFiles.length > 0) {
          await vscode.workspace.openTextDocument(sourceFiles[0]);
          logger.debug(`using configured language "${language}", opened ${sourceFiles[0].fsPath} to trigger LSP`);
        }
        return;
      }
      logger.debug(`configured language "${language}" not found in langDetectors, falling back to detection`);
    }

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

  async function openSymbol(symbol: string, kind?: string): Promise<void> {
    const config = getConfig();
    await activateLsp(config.langDetectors, config.language);

    logger.info(`resolving symbol: ${symbol}${kind ? `, kind: ${kind}` : ''}`);
    let result;
    try {
      result = await resolveSymbol(symbol, kind);
    } catch (e) {
      if (e instanceof Error) {
        await vscode.window.showErrorMessage(e.message);
      }
      return;
    }
    if (result.symbol) {
      const { location } = result.symbol;
      logger.info(`found: ${location.uri.fsPath}:${location.range.start.line}`);
      const document = await vscode.workspace.openTextDocument(location.uri);
      const editor = await vscode.window.showTextDocument(document);
      editor.selection = new vscode.Selection(location.range.start, location.range.start);
      editor.revealRange(location.range, vscode.TextEditorRevealType.InCenter);
    } else if (result.cancelled) {
      logger.info('cancelled');
    } else if (config.symbolNotFoundBehavior === 'search') {
      logger.info('not found, falling back to workspace search');
      await vscode.commands.executeCommand('workbench.action.findInFiles', {
        query: symbol,
      });
    } else {
      logger.info('not found');
      const kindInfo = kind ? ` (kind: ${kind})` : '';
      await vscode.window.showErrorMessage(
        `Symbol "${symbol}"${kindInfo} not found in workspace`
      );
    }
  }

  return { openSymbol };
}
