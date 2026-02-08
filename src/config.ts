import * as vscode from 'vscode';

// 'first': Use the first match. Fast, but may open wrong symbol if duplicates exist.
// 'quickpick': Show picker when multiple matches. Interactive but interrupts flow.
export type MultipleSymbolBehavior = 'first' | 'quickpick';

// 'new-window': Open workspace in new window, URI handler re-triggers in new window.
// 'current-window': Replace current workspace. Loses current context.
// 'error': Show error, require user to open workspace manually first.
export type WorkspaceNotOpenBehavior = 'new-window' | 'current-window' | 'error';

// 'error': Show error message when symbol is not found after retries.
// 'search': Open workspace search with symbol name pre-filled.
export type SymbolNotFoundBehavior = 'error' | 'search';

// 'debug': Show all logs including internal details (queries, retries, etc.)
// 'info': Show only important messages (symbol found/not found, errors)
export type LogLevel = 'debug' | 'info';

export type Language = 'go' | 'rust' | 'python' | 'ruby' | 'java' | 'typescript' | 'cpp';

export interface Logger {
  debug: (message: string) => void;
  info: (message: string) => void;
}

// Language detector for triggering LSP activation.
// markers: files that indicate this language (e.g., go.mod for Go)
// glob: pattern to find source files
// exclude: pattern to exclude (e.g., vendor directories)
export interface LangDetector {
  lang?: string;
  markers: string[];
  glob: string;
  exclude?: string;
}

export const defaultLangDetectors: LangDetector[] = [
  { lang: 'go', markers: ['go.mod'], glob: '**/*.go', exclude: '**/vendor/**' },
  { lang: 'rust', markers: ['Cargo.toml'], glob: '**/*.rs', exclude: '**/target/**' },
  { lang: 'python', markers: ['pyproject.toml', 'requirements.txt', 'setup.py'], glob: '**/*.py', exclude: '**/.venv/**' },
  { lang: 'ruby', markers: ['Gemfile'], glob: '**/*.rb', exclude: '**/vendor/**' },
  { lang: 'java', markers: ['pom.xml', 'build.gradle', 'build.gradle.kts'], glob: '**/*.java', exclude: '**/target/**' },
  { lang: 'cpp', markers: ['CMakeLists.txt'], glob: '**/*.{c,cpp,cc,cxx,h,hpp,hxx}', exclude: '**/build/**' },
  { lang: 'typescript', markers: ['tsconfig.json', 'package.json'], glob: '**/*.{ts,js}', exclude: '**/node_modules/**' },
];

// Default sort priority: type definitions first, then functions/methods.
export const defaultSymbolSortPriority: string[] = [
  'Class', 'Interface', 'Struct', 'Function', 'Method', 'Constructor',
  'Constant', 'Property', 'Field', 'Enum', 'Variable',
];

export interface Config {
  language?: Language;
  multipleSymbolBehavior: MultipleSymbolBehavior;
  workspaceNotOpenBehavior: WorkspaceNotOpenBehavior;
  symbolNotFoundBehavior: SymbolNotFoundBehavior;
  retryCount: number;
  retryInterval: number;
  langDetectors: LangDetector[];
  logLevel: LogLevel;
  symbolSortPriority: string[];
}

export function getConfig(): Config {
  const config = vscode.workspace.getConfiguration('symbolOpener');
  return {
    language: config.get<Language>('language'),
    multipleSymbolBehavior: config.get<MultipleSymbolBehavior>('multipleSymbolBehavior', 'first'),
    workspaceNotOpenBehavior: config.get<WorkspaceNotOpenBehavior>('workspaceNotOpenBehavior', 'new-window'),
    symbolNotFoundBehavior: config.get<SymbolNotFoundBehavior>('symbolNotFoundBehavior', 'search'),
    // LSP servers need time to index after workspace opens.
    retryCount: config.get<number>('retryCount', 10),
    retryInterval: config.get<number>('retryInterval', 500),
    langDetectors: config.get<LangDetector[]>('langDetectors', defaultLangDetectors),
    logLevel: config.get<LogLevel>('logLevel', 'info'),
    symbolSortPriority: config.get<string[]>('symbolSortPriority', defaultSymbolSortPriority),
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
