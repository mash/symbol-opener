import type * as vscode from 'vscode';

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
    findFiles(include: string, exclude?: string, maxResults?: number): Thenable<vscode.Uri[]>;
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
  Selection: typeof vscode.Selection;
  TextEditorRevealType: typeof vscode.TextEditorRevealType;
}

export interface GlobalState {
  get<T>(key: string): T | undefined;
  update(key: string, value: unknown): Thenable<void>;
}
