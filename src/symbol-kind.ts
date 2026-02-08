import type * as vscode from 'vscode';

export function buildKindNameToEnum(
  SymbolKind: typeof vscode.SymbolKind
): Record<string, number> {
  return {
    File: SymbolKind.File,
    Module: SymbolKind.Module,
    Namespace: SymbolKind.Namespace,
    Package: SymbolKind.Package,
    Class: SymbolKind.Class,
    Method: SymbolKind.Method,
    Property: SymbolKind.Property,
    Field: SymbolKind.Field,
    Constructor: SymbolKind.Constructor,
    Enum: SymbolKind.Enum,
    Interface: SymbolKind.Interface,
    Function: SymbolKind.Function,
    Variable: SymbolKind.Variable,
    Constant: SymbolKind.Constant,
    String: SymbolKind.String,
    Number: SymbolKind.Number,
    Boolean: SymbolKind.Boolean,
    Array: SymbolKind.Array,
    Object: SymbolKind.Object,
    Key: SymbolKind.Key,
    Null: SymbolKind.Null,
    EnumMember: SymbolKind.EnumMember,
    Struct: SymbolKind.Struct,
    Event: SymbolKind.Event,
    Operator: SymbolKind.Operator,
    TypeParameter: SymbolKind.TypeParameter,
  };
}

export function parseSymbolKind(
  kind: string,
  SymbolKind: typeof vscode.SymbolKind
): vscode.SymbolKind | undefined {
  return buildKindNameToEnum(SymbolKind)[kind];
}
