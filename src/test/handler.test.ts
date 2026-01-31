import { describe, it, mock } from 'node:test';
import assert from 'node:assert';
import { createHandler } from '../handler';
import type { Config, Logger } from '../config';
import type { VSCodeAPI } from '../vscode-api';

const SymbolKind = {
  File: 0, Module: 1, Namespace: 2, Package: 3, Class: 4, Method: 5,
  Property: 6, Field: 7, Constructor: 8, Enum: 9, Interface: 10,
  Function: 11, Variable: 12, Constant: 13, String: 14, Number: 15,
  Boolean: 16, Array: 17, Object: 18, Key: 19, Null: 20, EnumMember: 21,
  Struct: 22, Event: 23, Operator: 24, TypeParameter: 25,
} as const;

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
      showTextDocument: mock.fn(async () => ({ selection: null, revealRange: () => {} })),
      showErrorMessage: mock.fn(async () => undefined),
      showQuickPick: mock.fn(async () => undefined),
    },
    Uri: { file: (path: string) => ({ fsPath: path, path }) as any },
    SymbolKind: SymbolKind as any,
    Selection: class { constructor(public start: any, public end: any) {} } as any,
    TextEditorRevealType: { InCenter: 2 } as any,
    ...overrides,
  } as any;
}

function createMockUri(query: string) {
  return { query, toString: () => `cursor://mash.symbol-opener?${query}` } as any;
}

const defaultConfig: Config = {
  multipleSymbolBehavior: 'first',
  workspaceNotOpenBehavior: 'new-window',
  retryCount: 1,
  retryInterval: 0,
  langDetectors: [],
  logLevel: 'info',
};

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
    const classLocation = { uri: { fsPath: '/project/class.ts' }, range: mockRange };
    const vscode = createMockVSCode({
      commands: {
        executeCommand: mock.fn(async (cmd: string) => {
          if (cmd === 'vscode.executeWorkspaceSymbolProvider') {
            return [
              { name: 'Foo', kind: SymbolKind.Class, location: classLocation },
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

  it('prefers workspace symbol over external with workspace-priority', async () => {
    const mockRange = { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } };
    const workspaceLocation = { uri: { fsPath: '/project/src/foo.ts' }, range: mockRange };
    const externalLocation = { uri: { fsPath: '/other/node_modules/foo.ts' }, range: mockRange };
    const vscode = createMockVSCode({
      commands: {
        executeCommand: mock.fn(async (cmd: string) => {
          if (cmd === 'vscode.executeWorkspaceSymbolProvider') {
            return [
              { name: 'Foo', kind: SymbolKind.Function, location: externalLocation },
              { name: 'Foo', kind: SymbolKind.Function, location: workspaceLocation },
            ];
          }
          return undefined;
        }),
      },
    });
    const config = { ...defaultConfig, multipleSymbolBehavior: 'workspace-priority' as const };
    const { handleUri } = createHandler({ vscode, getConfig: () => config, logger: noopLogger });

    await handleUri(createMockUri('symbol=Foo&cwd=/project'));

    const openCalls = (vscode.workspace.openTextDocument as any).mock.calls;
    assert.strictEqual(openCalls.length, 1);
    assert.strictEqual(openCalls[0].arguments[0].fsPath, '/project/src/foo.ts');
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
        showTextDocument: mock.fn(async () => ({ selection: null, revealRange: () => {} })),
        showErrorMessage: mock.fn(async () => undefined),
        showQuickPick: mock.fn(async (items: any[]) => items[1]),
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
});
