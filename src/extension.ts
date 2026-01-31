import * as vscode from 'vscode';
import { createHandler } from './handler';
import { getConfig } from './config';

export function activate(context: vscode.ExtensionContext): void {
  const { handleUri } = createHandler({ vscode, getConfig });

  const uriHandler = vscode.window.registerUriHandler({ handleUri });
  context.subscriptions.push(uriHandler);
}

export function deactivate(): void {}
