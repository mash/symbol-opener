import * as vscode from 'vscode';
import { createHandler } from './handler';
import { getConfig, createLogger } from './config';

let outputChannel: vscode.OutputChannel;

export function activate(context: vscode.ExtensionContext): void {
  outputChannel = vscode.window.createOutputChannel('Symbol Opener');

  const config = getConfig();
  const logger = createLogger(config.logLevel, msg => outputChannel.appendLine(msg));
  logger.info('Extension activated');

  const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left);
  context.subscriptions.push(statusBar);

  const globalState = context.globalState;
  const { handleUri, processPendingUri } = createHandler({ vscode, getConfig, logger, globalState, statusBar });

  processPendingUri();

  const uriHandler = vscode.window.registerUriHandler({
    async handleUri(uri: vscode.Uri) {
      logger.info(`URI received: ${uri.toString()}`);
      logger.debug(`uri.query raw: ${uri.query}`);
      const decoded = decodeURIComponent(uri.query);
      logger.debug(`uri.query decoded: ${decoded}`);
      const params = new URLSearchParams(decoded);
      logger.debug(`parsed symbol: ${params.get('symbol')}, cwd: ${params.get('cwd')}`);
      return handleUri(uri);
    },
  });
  context.subscriptions.push(uriHandler);
}

export function deactivate(): void {}
