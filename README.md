# Symbol Opener

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

VS Code/Cursor extension that opens symbol definitions via URI handler. Designed to work with [osc8wrap](https://github.com/mash/osc8wrap) to make terminal output symbols clickable.

## URI Format

```
cursor://mash.symbol-opener?symbol=createHandler&cwd=/path/to/project&kind=Function
```

| Parameter | Required | Description                                          |
| --------- | -------- | ---------------------------------------------------- |
| `symbol`  | Yes      | Symbol name to search                                |
| `cwd`     | Yes      | Project root directory                               |
| `kind`    | No       | Filter by SymbolKind (Function, Class, Method, etc.) |

## Usage

```bash
open "cursor://mash.symbol-opener?symbol=createHandler&cwd=/Users/mash/src/github.com/mash/symbol-opener"
```

## How This Works

1. **URI Handling** - Receives `cursor://mash.symbol-opener?...` URI. If the target workspace (`cwd`) is not open, opens it in a new window (configurable via `workspaceNotOpenBehavior`) and coordinates between windows using filesystem-based message passing.

2. **LSP Activation** - VS Code's LSP servers only start after opening a file of that language. The extension detects the project language by looking for marker files (`go.mod`, `tsconfig.json`, `Cargo.toml`, etc.), then opens a matching source file in the background to trigger LSP startup.

3. **Symbol Resolution** - Queries the LSP for symbols matching the requested name. Since LSP may still be indexing, retries up to `retryCount` times with `retryInterval` delay. When multiple symbols match, sorts results using `symbolSortPriority` (preferring exported/public symbols by default) and selects based on `multipleSymbolBehavior`. If no exact match is found, shows fuzzy matches in a QuickPick for manual selection.

4. **Opening** - Navigates to the symbol's location and reveals it in the editor.

## Configuration

| Setting                                 | Default      | Description                                                                                                |
| --------------------------------------- | ------------ | ---------------------------------------------------------------------------------------------------------- |
| `symbolOpener.multipleSymbolBehavior`   | `first`      | `first`: use first match, `quickpick`: show picker                                                         |
| `symbolOpener.workspaceNotOpenBehavior` | `new-window` | `new-window`: open in new window, `current-window`: replace current, `error`: show error                   |
| `symbolOpener.language`                 | (unset)      | Override language detection: `go`, `rust`, `python`, `ruby`, `java`, `typescript` |
| `symbolOpener.retryCount`               | `10`         | LSP retry count (LSP may need time to index)                                                               |
| `symbolOpener.retryInterval`            | `500`        | Retry interval in ms                                                                                       |
| `symbolOpener.logLevel`                 | `info`       | `debug`: show all logs, `info`: show only important messages                                               |
| `symbolOpener.langDetectors`            | (see below)  | Language detectors for LSP activation                                                                      |

### Project-Level Language Override

If automatic language detection picks the wrong language (e.g., in a monorepo with multiple languages), you can explicitly set the language in `.vscode/settings.json`:

```json
{
  "symbolOpener.language": "go"
}
```

When set, this skips marker-based detection and directly uses the specified language's detector.

### Language Detectors

LSP servers only start after opening a file of that language. `langDetectors` configures which files trigger LSP activation:

```json
{
  "symbolOpener.langDetectors": [
    { "lang": "typescript", "markers": ["tsconfig.json", "package.json"], "glob": "**/*.{ts,js}", "exclude": "**/node_modules/**" },
    { "lang": "go", "markers": ["go.mod"], "glob": "**/*.go", "exclude": "**/vendor/**" },
    { "lang": "rust", "markers": ["Cargo.toml"], "glob": "**/*.rs", "exclude": "**/target/**" }
  ]
}
```

| Field     | Description                                           |
| --------- | ----------------------------------------------------- |
| `lang`    | Language identifier (optional, used with `language`)  |
| `markers` | Files indicating this language (e.g., `go.mod`)       |
| `glob`    | Pattern to find source files to open                  |
| `exclude` | Pattern to exclude (e.g., `**/node_modules/**`)       |

## Viewing Logs

1. Open the Output panel: **View → Output** (or `Cmd+Shift+U`)
2. Select **"Symbol Opener"** from the dropdown in the top-right corner
3. Set `symbolOpener.logLevel` to `debug` in Settings (`Cmd+,`) for detailed logs
4. **Reload the window** (`Cmd+Shift+P` → `Developer: Reload Window`) after changing log level

## Build

```bash
npm install
npm run compile
npm run package  # creates .vsix
```

## Test

```bash
npm test
```
