import * as vscode from 'vscode';

// 'first': Use the first match. Fast, but may open wrong symbol if duplicates exist.
// 'quickpick': Show picker when multiple matches. Interactive but interrupts flow.
export type MultipleSymbolBehavior = 'first' | 'quickpick';

// 'new-window': Open workspace in new window, URI handler re-triggers in new window.
// 'current-window': Replace current workspace. Loses current context.
// 'error': Show error, require user to open workspace manually first.
export type WorkspaceNotOpenBehavior = 'new-window' | 'current-window' | 'error';

// 'debug': Show all logs including internal details (queries, retries, etc.)
// 'info': Show only important messages (symbol found/not found, errors)
export type LogLevel = 'debug' | 'info';

export interface Logger {
  debug: (message: string) => void;
  info: (message: string) => void;
}

// Language detector for triggering LSP activation.
// markers: files that indicate this language (e.g., go.mod for Go)
// glob: pattern to find source files
// exclude: pattern to exclude (e.g., vendor directories)
export interface LangDetector {
  markers: string[];
  glob: string;
  exclude?: string;
}

export const defaultLangDetectors: LangDetector[] = [
  { markers: ['tsconfig.json', 'package.json'], glob: '**/*.{ts,js}', exclude: '**/node_modules/**' },
  { markers: ['go.mod'], glob: '**/*.go', exclude: '**/vendor/**' },
  { markers: ['Cargo.toml'], glob: '**/*.rs', exclude: '**/target/**' },
  { markers: ['pyproject.toml', 'requirements.txt', 'setup.py'], glob: '**/*.py', exclude: '**/.venv/**' },
  { markers: ['Gemfile'], glob: '**/*.rb', exclude: '**/vendor/**' },
  { markers: ['pom.xml', 'build.gradle', 'build.gradle.kts'], glob: '**/*.java', exclude: '**/target/**' },
];

export interface Config {
  multipleSymbolBehavior: MultipleSymbolBehavior;
  workspaceNotOpenBehavior: WorkspaceNotOpenBehavior;
  retryCount: number;
  retryInterval: number;
  langDetectors: LangDetector[];
  logLevel: LogLevel;
}

export function getConfig(): Config {
  const config = vscode.workspace.getConfiguration('symbolOpener');
  return {
    multipleSymbolBehavior: config.get<MultipleSymbolBehavior>('multipleSymbolBehavior', 'first'),
    workspaceNotOpenBehavior: config.get<WorkspaceNotOpenBehavior>('workspaceNotOpenBehavior', 'new-window'),
    // LSP servers need time to index after workspace opens.
    retryCount: config.get<number>('retryCount', 10),
    retryInterval: config.get<number>('retryInterval', 500),
    langDetectors: config.get<LangDetector[]>('langDetectors', defaultLangDetectors),
    logLevel: config.get<LogLevel>('logLevel', 'info'),
  };
}

function formatTimestamp(): string {
  const now = new Date();
  const pad = (n: number, digits = 2) => n.toString().padStart(digits, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ` +
    `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}.${pad(now.getMilliseconds(), 3)}`;
}

export function createLogger(
  logLevel: LogLevel,
  output: (message: string) => void
): Logger {
  return {
    debug: (message: string) => {
      if (logLevel === 'debug') {
        output(`${formatTimestamp()} [DEBUG] ${message}`);
      }
    },
    info: (message: string) => {
      output(`${formatTimestamp()} [INFO] ${message}`);
    },
  };
}
