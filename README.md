# Symbol Opener

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

VS Code/Cursor extension that opens symbol definitions via URI handler. Designed to work with [osc8wrap](https://github.com/mash/osc8wrap) to make terminal output symbols clickable.

## URI Format

```
cursor://mash.symbol-opener?symbol=createHandler&cwd=/path/to/project&kind=Function
```

| Parameter | Required | Description |
|-----------|----------|-------------|
| `symbol` | Yes | Symbol name to search |
| `cwd` | Yes | Project root directory |
| `kind` | No | Filter by SymbolKind (Function, Class, Method, etc.) |

## Usage

```bash
open "cursor://mash.symbol-opener?symbol=createHandler&cwd=/Users/you/project"
```

## Configuration

| Setting | Default | Description |
|---------|---------|-------------|
| `symbolOpener.multipleSymbolBehavior` | `first` | `first`: use first match, `quickpick`: show picker, `workspace-priority`: prefer current workspace folders |
| `symbolOpener.workspaceNotOpenBehavior` | `new-window` | `new-window`: open in new window, `current-window`: replace current, `error`: show error |
| `symbolOpener.retryCount` | `5` | LSP retry count (LSP may need time to index) |
| `symbolOpener.retryInterval` | `500` | Retry interval in ms |

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
