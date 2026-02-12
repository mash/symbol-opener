import { describe, it, mock } from 'node:test';
import assert from 'node:assert';
import { createHandler } from '../handler';
import { sortByKindPriority } from '../symbol-resolver';
import type { Config, Logger } from '../config';
import type { StatusBar, VSCodeAPI } from '../vscode-api';

const SymbolKind = {
  File: 0, Module: 1, Namespace: 2, Package: 3, Class: 4, Method: 5,
  Property: 6, Field: 7, Constructor: 8, Enum: 9, Interface: 10,
  Function: 11, Variable: 12, Constant: 13, String: 14, Number: 15,
  Boolean: 16, Array: 17, Object: 18, Key: 19, Null: 20, EnumMember: 21,
  Struct: 22, Event: 23, Operator: 24, TypeParameter: 25,
} as const;

const ProgressLocation = { Notification: 15, Window: 10 } as const;

function createMockVSCode(overrides: Partial<any> = {}): VSCodeAPI {
  return {
    commands: { executeCommand: mock.fn(async () => undefined) },
    workspace: {
      workspaceFolders: [{ uri: { fsPath: '/project' } }],
      openTextDocument: mock.fn(async (uri: any) => ({ uri })),
      getConfiguration: () => ({ get: <T>(_k: string, d: T) => d }),
      findFiles: mock.fn(async () => []),
    },
    window: {
      visibleTextEditors: [],
      showTextDocument: mock.fn(async () => ({ selection: null, revealRange: () => {} })),
      showErrorMessage: mock.fn(async () => undefined),
      showQuickPick: mock.fn(async () => undefined),
      withProgress: mock.fn(async (_opts: any, task: any) => task({ report: () => {} }, { isCancellationRequested: false })),
    },
    Uri: { file: (path: string) => ({ fsPath: path, path }) as any },
    SymbolKind: SymbolKind as any,
    ProgressLocation: ProgressLocation as any,
    Selection: class { constructor(public start: any, public end: any) {} } as any,
    TextEditorRevealType: { InCenter: 2 } as any,
    ...overrides,
  } as any;
}

function createMockUri(query: string) {
  return { query, toString: () => `cursor://mash.symbol-opener?${query}` } as any;
}

function createMockGlobalState() {
  const store = new Map<string, unknown>();
  return {
    get: <T>(key: string): T | undefined => store.get(key) as T | undefined,
    update: mock.fn(async (key: string, value: unknown) => {
      if (value === undefined) {
        store.delete(key);
      } else {
        store.set(key, value);
      }
    }),
    _store: store,
  };
}

const defaultConfig: Config = {
  language: undefined,
  multipleSymbolBehavior: 'first',
  workspaceNotOpenBehavior: 'new-window',
  symbolNotFoundBehavior: 'error',
  retryCount: 1,
  retryInterval: 0,
  langDetectors: [],
  logLevel: 'info',
  symbolSortPriority: ['Class', 'Interface', 'Struct', 'Function', 'Method', 'Constructor', 'Constant', 'Property', 'Field', 'Enum', 'Variable'],
};

function createMockStatusBar(): StatusBar & { _shown: boolean; _texts: string[] } {
  return {
    text: '',
    tooltip: undefined,
    _shown: false,
    _texts: [],
    show() { this._shown = true; this._texts.push(this.text); },
    hide() { this._shown = false; },
  };
}

const noop = () => {};
const noopLogger: Logger = { debug: noop, info: noop };

describe('handleUri', () => {
  it('shows error when symbol param is missing', async () => {
    const vscode = createMockVSCode();
    const { handleUri } = createHandler({ vscode, getConfig: () => defaultConfig, logger: noopLogger });

    await handleUri(createMockUri('cwd=/project'));

    const calls = (vscode.window.showErrorMessage as any).mock.calls;
    assert.strictEqual(calls.length, 1);
    assert.match(calls[0].arguments[0], /Missing required parameters/);
  });

  it('shows error when cwd param is missing', async () => {
    const vscode = createMockVSCode();
    const { handleUri } = createHandler({ vscode, getConfig: () => defaultConfig, logger: noopLogger });

    await handleUri(createMockUri('symbol=Foo'));

    assert.strictEqual((vscode.window.showErrorMessage as any).mock.calls.length, 1);
  });

  it('opens folder in new window when workspace not open', async () => {
    const vscode = createMockVSCode({
      workspace: {
        workspaceFolders: [{ uri: { fsPath: '/other' } }],
        openTextDocument: mock.fn(async (uri: any) => ({ uri })),
        getConfiguration: () => ({ get: <T>(_k: string, d: T) => d }),
      },
    });
    const { handleUri } = createHandler({ vscode, getConfig: () => defaultConfig, logger: noopLogger });

    await handleUri(createMockUri('symbol=Foo&cwd=/project'));

    const calls = (vscode.commands.executeCommand as any).mock.calls;
    assert.strictEqual(calls.length, 1);
    assert.strictEqual(calls[0].arguments[0], 'vscode.openFolder');
    assert.deepStrictEqual(calls[0].arguments[2], { forceNewWindow: true });
  });

  it('shows error when workspace not open and behavior is error', async () => {
    const vscode = createMockVSCode({
      workspace: {
        workspaceFolders: [],
        openTextDocument: mock.fn(async (uri: any) => ({ uri })),
        getConfiguration: () => ({ get: <T>(_k: string, d: T) => d }),
      },
    });
    const config = { ...defaultConfig, workspaceNotOpenBehavior: 'error' as const };
    const { handleUri } = createHandler({ vscode, getConfig: () => config, logger: noopLogger });

    await handleUri(createMockUri('symbol=Foo&cwd=/project'));

    const calls = (vscode.window.showErrorMessage as any).mock.calls;
    assert.strictEqual(calls.length, 1);
    assert.match(calls[0].arguments[0], /not open/);
  });

  it('resolves symbol and opens document', async () => {
    const location = {
      uri: { fsPath: '/project/foo.ts', path: '/project/foo.ts' },
      range: { start: { line: 10, character: 0 }, end: { line: 10, character: 5 } },
    };
    const vscode = createMockVSCode({
      commands: {
        executeCommand: mock.fn(async (cmd: string) => {
          if (cmd === 'vscode.executeWorkspaceSymbolProvider') {
            return [{ name: 'Foo', kind: SymbolKind.Function, location }];
          }
          return undefined;
        }),
      },
    });
    const { handleUri } = createHandler({ vscode, getConfig: () => defaultConfig, logger: noopLogger });

    await handleUri(createMockUri('symbol=Foo&cwd=/project'));

    assert.strictEqual((vscode.workspace.openTextDocument as any).mock.calls.length, 1);
    assert.strictEqual((vscode.window.showTextDocument as any).mock.calls.length, 1);
  });

  it('resolves Go method with Type.method format', async () => {
    const location = {
      uri: { fsPath: '/project/linker.go', path: '/project/linker.go' },
      range: { start: { line: 293, character: 0 }, end: { line: 293, character: 20 } },
    };
    const vscode = createMockVSCode({
      commands: {
        executeCommand: mock.fn(async (cmd: string) => {
          if (cmd === 'vscode.executeWorkspaceSymbolProvider') {
            return [{ name: 'Linker.buildSymbolPattern', kind: SymbolKind.Method, location }];
          }
          return undefined;
        }),
      },
    });
    const { handleUri } = createHandler({ vscode, getConfig: () => defaultConfig, logger: noopLogger });

    await handleUri(createMockUri('symbol=buildSymbolPattern&cwd=/project'));

    assert.strictEqual((vscode.workspace.openTextDocument as any).mock.calls.length, 1);
    assert.strictEqual((vscode.window.showTextDocument as any).mock.calls.length, 1);
  });

  it('filters by kind when provided', async () => {
    const mockRange = { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } };
    const fnLocation = { uri: { fsPath: '/project/fn.ts' }, range: mockRange };
    const varLocation = { uri: { fsPath: '/project/var.ts' }, range: mockRange };
    const vscode = createMockVSCode({
      commands: {
        executeCommand: mock.fn(async (cmd: string) => {
          if (cmd === 'vscode.executeWorkspaceSymbolProvider') {
            return [
              { name: 'Foo', kind: SymbolKind.Variable, location: varLocation },
              { name: 'Foo', kind: SymbolKind.Function, location: fnLocation },
            ];
          }
          return undefined;
        }),
      },
    });
    const { handleUri } = createHandler({ vscode, getConfig: () => defaultConfig, logger: noopLogger });

    await handleUri(createMockUri('symbol=Foo&cwd=/project&kind=Function'));

    const openCalls = (vscode.workspace.openTextDocument as any).mock.calls;
    assert.strictEqual(openCalls.length, 1);
    assert.strictEqual(openCalls[0].arguments[0].fsPath, '/project/fn.ts');
  });

  it('shows error when symbol not found', async () => {
    const vscode = createMockVSCode({
      commands: {
        executeCommand: mock.fn(async () => []),
      },
    });
    const { handleUri } = createHandler({ vscode, getConfig: () => defaultConfig, logger: noopLogger });

    await handleUri(createMockUri('symbol=NotFound&cwd=/project'));

    const calls = (vscode.window.showErrorMessage as any).mock.calls;
    assert.strictEqual(calls.length, 1);
    assert.match(calls[0].arguments[0], /not found/);
  });

  it('shows quickpick when multiple symbols and behavior is quickpick', async () => {
    const mockRange = { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } };
    const location1 = { uri: { fsPath: '/project/a.ts' }, range: mockRange };
    const location2 = { uri: { fsPath: '/project/b.ts' }, range: mockRange };
    const vscode = createMockVSCode({
      commands: {
        executeCommand: mock.fn(async (cmd: string) => {
          if (cmd === 'vscode.executeWorkspaceSymbolProvider') {
            return [
              { name: 'Foo', kind: SymbolKind.Function, location: location1 },
              { name: 'Foo', kind: SymbolKind.Function, location: location2 },
            ];
          }
          return undefined;
        }),
      },
      window: {
        visibleTextEditors: [],
        showTextDocument: mock.fn(async () => ({ selection: null, revealRange: () => {} })),
        showErrorMessage: mock.fn(async () => undefined),
        showQuickPick: mock.fn(async (items: any[]) => items[1]),
        withProgress: mock.fn(async (_opts: any, task: any) => task({ report: () => {} }, { isCancellationRequested: false })),
      },
    });
    const config = { ...defaultConfig, multipleSymbolBehavior: 'quickpick' as const };
    const { handleUri } = createHandler({ vscode, getConfig: () => config, logger: noopLogger });

    await handleUri(createMockUri('symbol=Foo&cwd=/project'));

    assert.strictEqual((vscode.window.showQuickPick as any).mock.calls.length, 1);
    const openCalls = (vscode.workspace.openTextDocument as any).mock.calls;
    assert.strictEqual(openCalls.length, 1);
    assert.strictEqual(openCalls[0].arguments[0].fsPath, '/project/b.ts');
  });

  it('saves pending URI to globalState when workspace not open', async () => {
    const globalState = createMockGlobalState();
    const vscode = createMockVSCode({
      workspace: {
        workspaceFolders: [{ uri: { fsPath: '/other' } }],
        openTextDocument: mock.fn(async (uri: any) => ({ uri })),
        getConfiguration: () => ({ get: <T>(_k: string, d: T) => d }),
      },
    });
    const { handleUri } = createHandler({ vscode, getConfig: () => defaultConfig, logger: noopLogger, globalState });

    await handleUri(createMockUri('symbol=Foo&cwd=/project&kind=Function'));

    const pending = globalState.get<{ symbol: string; cwd: string; kind?: string }>('pendingUri');
    assert.deepStrictEqual(pending, { symbol: 'Foo', cwd: '/project', kind: 'Function' });
  });

  it('does not save pending URI when behavior is error', async () => {
    const globalState = createMockGlobalState();
    const vscode = createMockVSCode({
      workspace: {
        workspaceFolders: [],
        openTextDocument: mock.fn(async (uri: any) => ({ uri })),
        getConfiguration: () => ({ get: <T>(_k: string, d: T) => d }),
      },
    });
    const config = { ...defaultConfig, workspaceNotOpenBehavior: 'error' as const };
    const { handleUri } = createHandler({ vscode, getConfig: () => config, logger: noopLogger, globalState });

    await handleUri(createMockUri('symbol=Foo&cwd=/project'));

    assert.strictEqual(globalState.get('pendingUri'), undefined);
  });

  it('processPendingUri resolves symbol from globalState and clears it', async () => {
    const globalState = createMockGlobalState();
    await globalState.update('pendingUri', { symbol: 'Bar', cwd: '/project' });

    const location = {
      uri: { fsPath: '/project/bar.ts', path: '/project/bar.ts' },
      range: { start: { line: 5, character: 0 }, end: { line: 5, character: 3 } },
    };
    const vscode = createMockVSCode({
      workspace: {
        workspaceFolders: [{ uri: { fsPath: '/project' } }],
        openTextDocument: mock.fn(async (uri: any) => ({ uri })),
        getConfiguration: () => ({ get: <T>(_k: string, d: T) => d }),
        findFiles: mock.fn(async () => []),
      },
      commands: {
        executeCommand: mock.fn(async (cmd: string) => {
          if (cmd === 'vscode.executeWorkspaceSymbolProvider') {
            return [{ name: 'Bar', kind: SymbolKind.Function, location }];
          }
          return undefined;
        }),
      },
    });
    const { processPendingUri } = createHandler({ vscode, getConfig: () => defaultConfig, logger: noopLogger, globalState });

    await processPendingUri();

    assert.strictEqual((vscode.workspace.openTextDocument as any).mock.calls.length, 1);
    assert.strictEqual(globalState.get('pendingUri'), undefined);
  });

  it('processPendingUri does nothing when no pending URI', async () => {
    const globalState = createMockGlobalState();
    const vscode = createMockVSCode();
    const { processPendingUri } = createHandler({ vscode, getConfig: () => defaultConfig, logger: noopLogger, globalState });

    await processPendingUri();

    assert.strictEqual((vscode.workspace.openTextDocument as any).mock.calls.length, 0);
  });

  it('processPendingUri skips if cwd does not match current workspace', async () => {
    const globalState = createMockGlobalState();
    await globalState.update('pendingUri', { symbol: 'Baz', cwd: '/other-project' });

    const vscode = createMockVSCode({
      workspace: {
        workspaceFolders: [{ uri: { fsPath: '/project' } }],
        openTextDocument: mock.fn(async (uri: any) => ({ uri })),
        getConfiguration: () => ({ get: <T>(_k: string, d: T) => d }),
      },
    });
    const { processPendingUri } = createHandler({ vscode, getConfig: () => defaultConfig, logger: noopLogger, globalState });

    await processPendingUri();

    // Should not process the URI (cwd doesn't match)
    assert.strictEqual((vscode.workspace.openTextDocument as any).mock.calls.length, 0);
    // Pending URI should remain so the correct window can pick it up on focus
    assert.deepStrictEqual(globalState.get('pendingUri'), { symbol: 'Baz', cwd: '/other-project' });
  });

  it('shows quickpick for fuzzy matches when no exact match', async () => {
    const mockRange = { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } };
    const location1 = { uri: { fsPath: '/project/corpus.ts' }, range: mockRange };
    const location2 = { uri: { fsPath: '/project/csv.ts' }, range: mockRange };
    const vscode = createMockVSCode({
      commands: {
        executeCommand: mock.fn(async (cmd: string) => {
          if (cmd === 'vscode.executeWorkspaceSymbolProvider') {
            // LSP returns fuzzy matches but none match "includeCSV" exactly
            return [
              { name: 'IncludeCorpusRemovals', kind: SymbolKind.Function, location: location1 },
              { name: 'IncludeCsvHeader', kind: SymbolKind.Function, location: location2 },
            ];
          }
          return undefined;
        }),
      },
      window: {
        visibleTextEditors: [],
        showTextDocument: mock.fn(async () => ({ selection: null, revealRange: () => {} })),
        showErrorMessage: mock.fn(async () => undefined),
        showQuickPick: mock.fn(async (items: any[]) => items[0]),
        withProgress: mock.fn(async (_opts: any, task: any) => task({ report: () => {} }, { isCancellationRequested: false })),
      },
    });
    const { handleUri } = createHandler({ vscode, getConfig: () => defaultConfig, logger: noopLogger });

    await handleUri(createMockUri('symbol=includeCSV&cwd=/project'));

    // Should show quickpick with fuzzy matches
    const quickPickCalls = (vscode.window.showQuickPick as any).mock.calls;
    assert.strictEqual(quickPickCalls.length, 1);
    assert.strictEqual(quickPickCalls[0].arguments[1].placeHolder, 'No exact match found. Select a similar symbol:');

    // Should open the selected symbol
    const openCalls = (vscode.workspace.openTextDocument as any).mock.calls;
    assert.strictEqual(openCalls.length, 1);
    assert.strictEqual(openCalls[0].arguments[0].fsPath, '/project/corpus.ts');
  });

  it('does not retry when LSP returns fuzzy matches but no exact match', async () => {
    let executeCount = 0;
    const mockRange = { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } };
    const location = { uri: { fsPath: '/project/foo.ts' }, range: mockRange };
    const vscode = createMockVSCode({
      commands: {
        executeCommand: mock.fn(async (cmd: string) => {
          if (cmd === 'vscode.executeWorkspaceSymbolProvider') {
            executeCount++;
            return [{ name: 'FooBar', kind: SymbolKind.Function, location }];
          }
          return undefined;
        }),
      },
      window: {
        visibleTextEditors: [],
        showTextDocument: mock.fn(async () => ({ selection: null, revealRange: () => {} })),
        showErrorMessage: mock.fn(async () => undefined),
        showQuickPick: mock.fn(async () => undefined), // User cancels quickpick
        withProgress: mock.fn(async (_opts: any, task: any) => task({ report: () => {} }, { isCancellationRequested: false })),
      },
    });
    const config = { ...defaultConfig, retryCount: 3 };
    const { handleUri } = createHandler({ vscode, getConfig: () => config, logger: noopLogger });

    await handleUri(createMockUri('symbol=Foo&cwd=/project'));

    // Should only call LSP once (no retry because fuzzy matches exist)
    assert.strictEqual(executeCount, 1);
    // Quickpick should be shown
    assert.strictEqual((vscode.window.showQuickPick as any).mock.calls.length, 1);
  });

  it('falls back to workspace search when quickpick is cancelled on exact match', async () => {
    let findInFilesArgs: any;
    const mockRange = { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } };
    const location1 = { uri: { fsPath: '/project/a.ts' }, range: mockRange };
    const location2 = { uri: { fsPath: '/project/b.ts' }, range: mockRange };
    const vscode = createMockVSCode({
      commands: {
        executeCommand: mock.fn(async (cmd: string, ...args: any[]) => {
          if (cmd === 'vscode.executeWorkspaceSymbolProvider') {
            return [
              { name: 'Foo', kind: SymbolKind.Function, location: location1 },
              { name: 'Foo', kind: SymbolKind.Function, location: location2 },
            ];
          }
          if (cmd === 'workbench.action.findInFiles') {
            findInFilesArgs = args[0];
          }
          return undefined;
        }),
      },
      window: {
        visibleTextEditors: [],
        showTextDocument: mock.fn(async () => ({ selection: null, revealRange: () => {} })),
        showErrorMessage: mock.fn(async () => undefined),
        showQuickPick: mock.fn(async () => undefined),
        withProgress: mock.fn(async (_opts: any, task: any) => task({ report: () => {} }, { isCancellationRequested: false })),
      },
    });
    const config = { ...defaultConfig, multipleSymbolBehavior: 'quickpick' as const };
    const { handleUri } = createHandler({ vscode, getConfig: () => config, logger: noopLogger });

    await handleUri(createMockUri('symbol=Foo&cwd=/project'));

    assert.strictEqual((vscode.window.showErrorMessage as any).mock.calls.length, 0);
    assert.deepStrictEqual(findInFilesArgs, { query: 'Foo' });
  });

  it('does not retry when exact match quickpick is cancelled', async () => {
    let executeCount = 0;
    let findInFilesArgs: any;
    const mockRange = { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } };
    const location1 = { uri: { fsPath: '/project/a.ts' }, range: mockRange };
    const location2 = { uri: { fsPath: '/project/b.ts' }, range: mockRange };
    const vscode = createMockVSCode({
      commands: {
        executeCommand: mock.fn(async (cmd: string, ...args: any[]) => {
          if (cmd === 'vscode.executeWorkspaceSymbolProvider') {
            executeCount++;
            return [
              { name: 'Foo', kind: SymbolKind.Function, location: location1 },
              { name: 'Foo', kind: SymbolKind.Function, location: location2 },
            ];
          }
          if (cmd === 'workbench.action.findInFiles') {
            findInFilesArgs = args[0];
          }
          return undefined;
        }),
      },
      window: {
        visibleTextEditors: [],
        showTextDocument: mock.fn(async () => ({ selection: null, revealRange: () => {} })),
        showErrorMessage: mock.fn(async () => undefined),
        showQuickPick: mock.fn(async () => undefined),
        withProgress: mock.fn(async (_opts: any, task: any) => task({ report: () => {} }, { isCancellationRequested: false })),
      },
    });
    const config = { ...defaultConfig, multipleSymbolBehavior: 'quickpick' as const, retryCount: 3 };
    const { handleUri } = createHandler({ vscode, getConfig: () => config, logger: noopLogger });

    await handleUri(createMockUri('symbol=Foo&cwd=/project'));

    assert.strictEqual(executeCount, 1);
    assert.strictEqual((vscode.window.showErrorMessage as any).mock.calls.length, 0);
    assert.deepStrictEqual(findInFilesArgs, { query: 'Foo' });
  });

  it('falls back to workspace search when fuzzy match quickpick is cancelled', async () => {
    let findInFilesArgs: any;
    const mockRange = { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } };
    const location = { uri: { fsPath: '/project/foo.ts' }, range: mockRange };
    const vscode = createMockVSCode({
      commands: {
        executeCommand: mock.fn(async (cmd: string, ...args: any[]) => {
          if (cmd === 'vscode.executeWorkspaceSymbolProvider') {
            return [{ name: 'FooBar', kind: SymbolKind.Function, location }];
          }
          if (cmd === 'workbench.action.findInFiles') {
            findInFilesArgs = args[0];
          }
          return undefined;
        }),
      },
      window: {
        visibleTextEditors: [],
        showTextDocument: mock.fn(async () => ({ selection: null, revealRange: () => {} })),
        showErrorMessage: mock.fn(async () => undefined),
        showQuickPick: mock.fn(async () => undefined),
        withProgress: mock.fn(async (_opts: any, task: any) => task({ report: () => {} }, { isCancellationRequested: false })),
      },
    });
    const { handleUri } = createHandler({ vscode, getConfig: () => defaultConfig, logger: noopLogger });

    await handleUri(createMockUri('symbol=Foo&cwd=/project'));

    assert.strictEqual((vscode.window.showErrorMessage as any).mock.calls.length, 0);
    assert.deepStrictEqual(findInFilesArgs, { query: 'Foo' });
  });

  it('retries when LSP returns empty results', async () => {
    let executeCount = 0;
    const vscode = createMockVSCode({
      commands: {
        executeCommand: mock.fn(async (cmd: string) => {
          if (cmd === 'vscode.executeWorkspaceSymbolProvider') {
            executeCount++;
            return []; // Empty results
          }
          return undefined;
        }),
      },
    });
    const config = { ...defaultConfig, retryCount: 3, retryInterval: 0 };
    const { handleUri } = createHandler({ vscode, getConfig: () => config, logger: noopLogger });

    await handleUri(createMockUri('symbol=Foo&cwd=/project'));

    // Should retry 3 times (retryCount) with 2 query transforms each = 6 calls
    assert.strictEqual(executeCount, 6);
  });

  it('opens workspace search when symbol not found and behavior is search', async () => {
    let findInFilesArgs: any;
    const vscode = createMockVSCode({
      commands: {
        executeCommand: mock.fn(async (cmd: string, ...args: any[]) => {
          if (cmd === 'vscode.executeWorkspaceSymbolProvider') {
            return [];
          }
          if (cmd === 'workbench.action.findInFiles') {
            findInFilesArgs = args[0];
          }
          return undefined;
        }),
      },
    });
    const config = { ...defaultConfig, symbolNotFoundBehavior: 'search' as const };
    const { handleUri } = createHandler({ vscode, getConfig: () => config, logger: noopLogger });

    await handleUri(createMockUri('symbol=NotFound&cwd=/project'));

    assert.deepStrictEqual(findInFilesArgs, { query: 'NotFound' });
    assert.strictEqual((vscode.window.showErrorMessage as any).mock.calls.length, 0);
  });


  it('sorts symbols by kind priority with first behavior', async () => {
    const mockRange = { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } };
    const fnLocation = { uri: { fsPath: '/project/fn.ts' }, range: mockRange };
    const classLocation = { uri: { fsPath: '/project/class.ts' }, range: mockRange };
    const vscode = createMockVSCode({
      commands: {
        executeCommand: mock.fn(async (cmd: string) => {
          if (cmd === 'vscode.executeWorkspaceSymbolProvider') {
            return [
              { name: 'Foo', kind: SymbolKind.Function, location: fnLocation },
              { name: 'Foo', kind: SymbolKind.Class, location: classLocation },
            ];
          }
          return undefined;
        }),
      },
    });
    const { handleUri } = createHandler({ vscode, getConfig: () => defaultConfig, logger: noopLogger });

    await handleUri(createMockUri('symbol=Foo&cwd=/project'));

    const openCalls = (vscode.workspace.openTextDocument as any).mock.calls;
    assert.strictEqual(openCalls.length, 1);
    assert.strictEqual(openCalls[0].arguments[0].fsPath, '/project/class.ts');
  });

  it('sorts quickpick items by kind priority', async () => {
    const mockRange = { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } };
    const fnLocation = { uri: { fsPath: '/project/fn.ts' }, range: mockRange };
    const classLocation = { uri: { fsPath: '/project/class.ts' }, range: mockRange };
    let quickPickItems: any[] = [];
    const vscode = createMockVSCode({
      commands: {
        executeCommand: mock.fn(async (cmd: string) => {
          if (cmd === 'vscode.executeWorkspaceSymbolProvider') {
            return [
              { name: 'Foo', kind: SymbolKind.Function, location: fnLocation },
              { name: 'Foo', kind: SymbolKind.Class, location: classLocation },
            ];
          }
          return undefined;
        }),
      },
      window: {
        visibleTextEditors: [],
        showTextDocument: mock.fn(async () => ({ selection: null, revealRange: () => {} })),
        showErrorMessage: mock.fn(async () => undefined),
        showQuickPick: mock.fn(async (items: any[]) => {
          quickPickItems = items;
          return items[0];
        }),
        withProgress: mock.fn(async (_opts: any, task: any) => task({ report: () => {} }, { isCancellationRequested: false })),
      },
    });
    const config = { ...defaultConfig, multipleSymbolBehavior: 'quickpick' as const };
    const { handleUri } = createHandler({ vscode, getConfig: () => config, logger: noopLogger });

    await handleUri(createMockUri('symbol=Foo&cwd=/project'));

    assert.strictEqual(quickPickItems[0].detail, '/project/class.ts');
    assert.strictEqual(quickPickItems[1].detail, '/project/fn.ts');
  });

  it('shows error when symbolSortPriority contains invalid kind name', async () => {
    const mockRange = { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } };
    const location = { uri: { fsPath: '/project/foo.ts' }, range: mockRange };
    const vscode = createMockVSCode({
      commands: {
        executeCommand: mock.fn(async (cmd: string) => {
          if (cmd === 'vscode.executeWorkspaceSymbolProvider') {
            return [{ name: 'Foo', kind: SymbolKind.Function, location }];
          }
          return undefined;
        }),
      },
    });
    const config = { ...defaultConfig, symbolSortPriority: ['InvalidKind', 'Function'] };
    const { handleUri } = createHandler({ vscode, getConfig: () => config, logger: noopLogger });

    await handleUri(createMockUri('symbol=Foo&cwd=/project'));

    const calls = (vscode.window.showErrorMessage as any).mock.calls;
    assert.strictEqual(calls.length, 1);
    assert.match(calls[0].arguments[0], /Invalid SymbolKind.*InvalidKind/);
  });

  it('uses configured language to activate LSP instead of marker detection', async () => {
    const langDetectors = [
      { lang: 'go', markers: ['go.mod'], glob: '**/*.go' },
      { lang: 'typescript', markers: ['tsconfig.json'], glob: '**/*.ts' },
    ];
    const goFile = { fsPath: '/project/main.go', path: '/project/main.go' };
    const location = {
      uri: { fsPath: '/project/foo.go', path: '/project/foo.go' },
      range: { start: { line: 10, character: 0 }, end: { line: 10, character: 5 } },
    };

    let findFilesPatterns: string[] = [];
    const vscode = createMockVSCode({
      workspace: {
        workspaceFolders: [{ uri: { fsPath: '/project' } }],
        openTextDocument: mock.fn(async (uri: any) => ({ uri })),
        getConfiguration: () => ({ get: <T>(_k: string, d: T) => d }),
        findFiles: mock.fn(async (pattern: string) => {
          findFilesPatterns.push(pattern);
          if (pattern === '**/*.go') return [goFile];
          return [];
        }),
      },
      commands: {
        executeCommand: mock.fn(async (cmd: string) => {
          if (cmd === 'vscode.executeWorkspaceSymbolProvider') {
            return [{ name: 'Foo', kind: SymbolKind.Function, location }];
          }
          return undefined;
        }),
      },
    });

    const config = { ...defaultConfig, language: 'go' as const, langDetectors };
    const { handleUri } = createHandler({ vscode, getConfig: () => config, logger: noopLogger });

    await handleUri(createMockUri('symbol=Foo&cwd=/project'));

    // Should use go glob pattern directly without checking markers
    assert.ok(findFilesPatterns.includes('**/*.go'), 'Should find go files');
    assert.ok(!findFilesPatterns.includes('go.mod'), 'Should NOT check for go.mod marker');
  });

  it('updates status bar during symbol resolution', async () => {
    const location = {
      uri: { fsPath: '/project/foo.ts', path: '/project/foo.ts' },
      range: { start: { line: 10, character: 0 }, end: { line: 10, character: 5 } },
    };
    const vscode = createMockVSCode({
      commands: {
        executeCommand: mock.fn(async (cmd: string) => {
          if (cmd === 'vscode.executeWorkspaceSymbolProvider') {
            return [{ name: 'Foo', kind: SymbolKind.Function, location }];
          }
          return undefined;
        }),
      },
    });
    const statusBar = createMockStatusBar();
    const { handleUri } = createHandler({ vscode, getConfig: () => defaultConfig, logger: noopLogger, statusBar });

    await handleUri(createMockUri('symbol=Foo&cwd=/project'));

    assert.ok(statusBar._texts.some(t => t.includes('Activating LSP')));
    assert.ok(statusBar._texts.some(t => t.includes('Searching "Foo"')));
    assert.ok(statusBar._texts.some(t => t.includes('Found "Foo"')));
  });


  it('kind=Function matches Method symbols', async () => {
    const mockRange = { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } };
    const methodLocation = { uri: { fsPath: '/project/method.go' }, range: mockRange };
    const vscode = createMockVSCode({
      commands: {
        executeCommand: mock.fn(async (cmd: string) => {
          if (cmd === 'vscode.executeWorkspaceSymbolProvider') {
            return [
              { name: 'Linker.buildSymbolPattern', kind: SymbolKind.Method, location: methodLocation },
            ];
          }
          return undefined;
        }),
      },
    });
    const { handleUri } = createHandler({ vscode, getConfig: () => defaultConfig, logger: noopLogger });

    await handleUri(createMockUri('symbol=buildSymbolPattern&cwd=/project&kind=Function'));

    const openCalls = (vscode.workspace.openTextDocument as any).mock.calls;
    assert.strictEqual(openCalls.length, 1);
    assert.strictEqual(openCalls[0].arguments[0].fsPath, '/project/method.go');
  });

  it('kind=Function matches Constructor symbols', async () => {
    const mockRange = { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } };
    const ctorLocation = { uri: { fsPath: '/project/ctor.ts' }, range: mockRange };
    const vscode = createMockVSCode({
      commands: {
        executeCommand: mock.fn(async (cmd: string) => {
          if (cmd === 'vscode.executeWorkspaceSymbolProvider') {
            return [
              { name: 'Foo', kind: SymbolKind.Constructor, location: ctorLocation },
            ];
          }
          return undefined;
        }),
      },
    });
    const { handleUri } = createHandler({ vscode, getConfig: () => defaultConfig, logger: noopLogger });

    await handleUri(createMockUri('symbol=Foo&cwd=/project&kind=Function'));

    const openCalls = (vscode.workspace.openTextDocument as any).mock.calls;
    assert.strictEqual(openCalls.length, 1);
    assert.strictEqual(openCalls[0].arguments[0].fsPath, '/project/ctor.ts');
  });

  it('kind=Method does not match Function symbols', async () => {
    const mockRange = { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } };
    const fnLocation = { uri: { fsPath: '/project/fn.ts' }, range: mockRange };
    const vscode = createMockVSCode({
      commands: {
        executeCommand: mock.fn(async (cmd: string) => {
          if (cmd === 'vscode.executeWorkspaceSymbolProvider') {
            return [
              { name: 'Foo', kind: SymbolKind.Function, location: fnLocation },
            ];
          }
          return undefined;
        }),
      },
    });
    const { handleUri } = createHandler({ vscode, getConfig: () => defaultConfig, logger: noopLogger });

    await handleUri(createMockUri('symbol=Foo&cwd=/project&kind=Method'));

    const openCalls = (vscode.workspace.openTextDocument as any).mock.calls;
    assert.strictEqual(openCalls.length, 0);
    const errorCalls = (vscode.window.showErrorMessage as any).mock.calls;
    assert.strictEqual(errorCalls.length, 1);
    assert.match(errorCalls[0].arguments[0], /not found/);
  });

  it('shows warning in status bar when symbol not found', async () => {
    const vscode = createMockVSCode({
      commands: {
        executeCommand: mock.fn(async () => []),
      },
    });
    const statusBar = createMockStatusBar();
    const { handleUri } = createHandler({ vscode, getConfig: () => defaultConfig, logger: noopLogger, statusBar });

    await handleUri(createMockUri('symbol=Missing&cwd=/project'));

    assert.ok(statusBar._texts.some(t => t.includes('$(warning)') && t.includes('Missing')));
  });

  it('skips LSP activation and retries when visible editor matches langDetector glob', async () => {
    let executeCount = 0;
    const vscode = createMockVSCode({
      commands: {
        executeCommand: mock.fn(async (cmd: string) => {
          if (cmd === 'vscode.executeWorkspaceSymbolProvider') {
            executeCount++;
            return [];
          }
          return undefined;
        }),
      },
      window: {
        visibleTextEditors: [{ document: { uri: { fsPath: '/project/main.go' } } }],
        showTextDocument: mock.fn(async () => ({ selection: null, revealRange: () => {} })),
        showErrorMessage: mock.fn(async () => undefined),
        showQuickPick: mock.fn(async () => undefined),
        withProgress: mock.fn(async (_opts: any, task: any) => task({ report: () => {} }, { isCancellationRequested: false })),
      },
    });
    const config = {
      ...defaultConfig,
      retryCount: 5,
      retryInterval: 0,
      langDetectors: [{ markers: ['go.mod'], glob: '**/*.go' }],
    };
    const statusBar = createMockStatusBar();
    const { handleUri } = createHandler({ vscode, getConfig: () => config, logger: noopLogger, statusBar });

    await handleUri(createMockUri('symbol=NotFound&cwd=/project'));

    // findSymbols tries 2 query transforms (#name and name) per attempt.
    // Only 2 calls (1 attempt x 2 transforms), not 10 (5 retries x 2)
    assert.strictEqual(executeCount, 2);
    assert.ok(!statusBar._texts.some(t => t.includes('Activating LSP')));
    assert.strictEqual((vscode.workspace.findFiles as any).mock.calls.length, 0);
  });

  it('retries normally when no visible editor matches', async () => {
    let executeCount = 0;
    const vscode = createMockVSCode({
      commands: {
        executeCommand: mock.fn(async (cmd: string) => {
          if (cmd === 'vscode.executeWorkspaceSymbolProvider') {
            executeCount++;
            return [];
          }
          return undefined;
        }),
      },
    });
    const config = {
      ...defaultConfig,
      retryCount: 3,
      retryInterval: 0,
      langDetectors: [{ markers: ['go.mod'], glob: '**/*.go' }],
    };
    const { handleUri } = createHandler({ vscode, getConfig: () => config, logger: noopLogger });

    await handleUri(createMockUri('symbol=NotFound&cwd=/project'));

    // 3 retries x 2 query transforms = 6 calls
    assert.strictEqual(executeCount, 6);
  });

  it('uses configured language to match visible editors', async () => {
    let executeCount = 0;
    const vscode = createMockVSCode({
      commands: {
        executeCommand: mock.fn(async (cmd: string) => {
          if (cmd === 'vscode.executeWorkspaceSymbolProvider') {
            executeCount++;
            return [];
          }
          return undefined;
        }),
      },
      window: {
        visibleTextEditors: [{ document: { uri: { fsPath: '/project/main.go' } } }],
        showTextDocument: mock.fn(async () => ({ selection: null, revealRange: () => {} })),
        showErrorMessage: mock.fn(async () => undefined),
        showQuickPick: mock.fn(async () => undefined),
        withProgress: mock.fn(async (_opts: any, task: any) => task({ report: () => {} }, { isCancellationRequested: false })),
      },
    });
    const config = {
      ...defaultConfig,
      language: 'go' as const,
      retryCount: 5,
      retryInterval: 0,
      langDetectors: [
        { lang: 'go', markers: ['go.mod'], glob: '**/*.go' },
        { lang: 'typescript', markers: ['tsconfig.json'], glob: '**/*.ts' },
      ],
    };
    const { handleUri } = createHandler({ vscode, getConfig: () => config, logger: noopLogger });

    await handleUri(createMockUri('symbol=NotFound&cwd=/project'));

    // Should skip retries: 1 attempt x 2 transforms = 2
    assert.strictEqual(executeCount, 2);
  });

  it('does not skip retries when visible editor extension does not match configured language', async () => {
    let executeCount = 0;
    const vscode = createMockVSCode({
      commands: {
        executeCommand: mock.fn(async (cmd: string) => {
          if (cmd === 'vscode.executeWorkspaceSymbolProvider') {
            executeCount++;
            return [];
          }
          return undefined;
        }),
      },
      window: {
        visibleTextEditors: [{ document: { uri: { fsPath: '/project/main.go' } } }],
        showTextDocument: mock.fn(async () => ({ selection: null, revealRange: () => {} })),
        showErrorMessage: mock.fn(async () => undefined),
        showQuickPick: mock.fn(async () => undefined),
        withProgress: mock.fn(async (_opts: any, task: any) => task({ report: () => {} }, { isCancellationRequested: false })),
      },
    });
    const config = {
      ...defaultConfig,
      language: 'typescript' as const,
      retryCount: 3,
      retryInterval: 0,
      langDetectors: [
        { lang: 'go', markers: ['go.mod'], glob: '**/*.go' },
        { lang: 'typescript', markers: ['tsconfig.json'], glob: '**/*.ts' },
      ],
    };
    const { handleUri } = createHandler({ vscode, getConfig: () => config, logger: noopLogger });

    await handleUri(createMockUri('symbol=NotFound&cwd=/project'));

    // .go visible but language=typescript, so should retry: 3 x 2 = 6
    assert.strictEqual(executeCount, 6);
  });
});

describe('sortByKindPriority', () => {
  it('sorts symbols by priority order', () => {
    const mockRange = { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } };
    const symbols = [
      { name: 'A', kind: SymbolKind.Variable, location: { uri: { fsPath: '/a.ts' }, range: mockRange } },
      { name: 'B', kind: SymbolKind.Class, location: { uri: { fsPath: '/b.ts' }, range: mockRange } },
      { name: 'C', kind: SymbolKind.Function, location: { uri: { fsPath: '/c.ts' }, range: mockRange } },
    ] as any[];

    const sorted = sortByKindPriority(symbols, ['Class', 'Function', 'Variable'], SymbolKind as any);

    assert.strictEqual(sorted[0].name, 'B');
    assert.strictEqual(sorted[1].name, 'C');
    assert.strictEqual(sorted[2].name, 'A');
  });

  it('puts kinds not in priority list at the end', () => {
    const mockRange = { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } };
    const symbols = [
      { name: 'A', kind: SymbolKind.Enum, location: { uri: { fsPath: '/a.ts' }, range: mockRange } },
      { name: 'B', kind: SymbolKind.Class, location: { uri: { fsPath: '/b.ts' }, range: mockRange } },
    ] as any[];

    const sorted = sortByKindPriority(symbols, ['Class'], SymbolKind as any);

    assert.strictEqual(sorted[0].name, 'B');
    assert.strictEqual(sorted[1].name, 'A');
  });

  it('throws error for invalid kind name', () => {
    const symbols = [] as any[];

    assert.throws(
      () => sortByKindPriority(symbols, ['InvalidKind'], SymbolKind as any),
      /Invalid SymbolKind.*InvalidKind/
    );
  });

  it('does not mutate original array', () => {
    const mockRange = { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } };
    const symbols = [
      { name: 'A', kind: SymbolKind.Variable, location: { uri: { fsPath: '/a.ts' }, range: mockRange } },
      { name: 'B', kind: SymbolKind.Class, location: { uri: { fsPath: '/b.ts' }, range: mockRange } },
    ] as any[];

    sortByKindPriority(symbols, ['Class', 'Variable'], SymbolKind as any);

    assert.strictEqual(symbols[0].name, 'A');
    assert.strictEqual(symbols[1].name, 'B');
  });
});

