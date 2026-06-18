import Fuse from "fuse.js";
import * as path from "path";

export interface SymbolMatch {
  symbol: string;
  paths: string[];
}

/**
 * Manages the in-memory representation of exported symbols in the workspace.
 * Allows querying symbols using exact and fuzzy matching.
 */
export class WorkspaceIndex {
  // Maps a symbol name to the set of absolute file paths that export it
  private symbolToFiles = new Map<string, Set<string>>();

  // Maps an absolute file path to the set of symbol names it exports
  private fileToSymbols = new Map<string, Set<string>>();

  // Fuse instance for fuzzy search
  private fuse: Fuse<string> | null = null;
  private isFuseDirty = true;

  constructor(private workspaceRoot: string) {
    this.workspaceRoot = path.resolve(workspaceRoot);
  }

  /**
   * Adds or updates a file in the index with its exported symbols.
   * 
   * @param filePath Relative or absolute path to the file.
   * @param symbols List of exported symbols.
   */
  public updateFile(filePath: string, symbols: string[]): void {
    const absolutePath = path.resolve(this.workspaceRoot, filePath);

    // First remove any existing associations for this file
    this.removeFile(absolutePath);

    const symbolSet = new Set<string>();
    for (const symbol of symbols) {
      symbolSet.add(symbol);

      let fileSet = this.symbolToFiles.get(symbol);
      if (!fileSet) {
        fileSet = new Set<string>();
        this.symbolToFiles.set(symbol, fileSet);
      }
      fileSet.add(absolutePath);
    }

    this.fileToSymbols.set(absolutePath, symbolSet);
    this.isFuseDirty = true;
  }

  /**
   * Removes a file and its symbols from the index.
   * 
   * @param filePath Relative or absolute path to the file.
   */
  public removeFile(filePath: string): void {
    const absolutePath = path.resolve(this.workspaceRoot, filePath);
    const symbols = this.fileToSymbols.get(absolutePath);
    if (!symbols) return;

    for (const symbol of symbols) {
      const fileSet = this.symbolToFiles.get(symbol);
      if (fileSet) {
        fileSet.delete(absolutePath);
        if (fileSet.size === 0) {
          this.symbolToFiles.delete(symbol);
        }
      }
    }

    this.fileToSymbols.delete(absolutePath);
    this.isFuseDirty = true;
  }

  /**
   * Finds a symbol by name. Checks exact matches first, then falls back to fuzzy.
   * Paths returned are relative to the workspace root.
   */
  public findSymbol(symbolName: string): SymbolMatch[] {
    // 1. Exact Match Check
    const exactFiles = this.symbolToFiles.get(symbolName);
    if (exactFiles && exactFiles.size > 0) {
      return [
        {
          symbol: symbolName,
          paths: Array.from(exactFiles).map((p) =>
            path.relative(this.workspaceRoot, p)
          ),
        },
      ];
    }

    // 2. Fuzzy Match Fallback
    const fuseInstance = this.getFuseInstance();
    const fuzzyResults = fuseInstance.search(symbolName);

    const matches: SymbolMatch[] = [];
    const topMatches = fuzzyResults.slice(0, 5);

    for (const result of topMatches) {
      const sym = result.item;
      const files = this.symbolToFiles.get(sym);
      if (files && files.size > 0) {
        matches.push({
          symbol: sym,
          paths: Array.from(files).map((p) =>
            path.relative(this.workspaceRoot, p)
          ),
        });
      }
    }

    return matches;
  }

  /**
   * Returns all indexed file paths relative to the workspace root.
   */
  public getIndexedFiles(): string[] {
    return Array.from(this.fileToSymbols.keys()).map((p) =>
      path.relative(this.workspaceRoot, p)
    );
  }

  /**
   * Helper to lazily initialize or refresh the Fuse.js instance.
   */
  private getFuseInstance(): Fuse<string> {
    if (this.isFuseDirty || !this.fuse) {
      const symbolsList = Array.from(this.symbolToFiles.keys());
      this.fuse = new Fuse(symbolsList, {
        threshold: 0.4,
        distance: 100,
      });
      this.isFuseDirty = false;
    }
    return this.fuse;
  }

  /**
   * Returns the count of unique symbols.
   */
  public getSymbolCount(): number {
    return this.symbolToFiles.size;
  }

  /**
   * Returns the count of indexed files.
   */
  public getFileCount(): number {
    return this.fileToSymbols.size;
  }
}
