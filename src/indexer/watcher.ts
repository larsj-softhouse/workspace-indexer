import chokidar from "chokidar";
import ignore from "ignore";
import * as fs from "fs";
import * as path from "path";
import { WorkspaceIndex } from "./state.js";
import { parseTsFile } from "../parser/ts-parser.js";
import { parseVueFile } from "../parser/vue-parser.js";

/**
 * Watches the workspace directory for file changes and updates the index accordingly.
 * Respects .gitignore rules and ignores node_modules, dist, and .git.
 */
export class WorkspaceWatcher {
  private watcher: chokidar.FSWatcher | null = null;
  private ig = ignore.default(); // In ESM, ignore library has a default export or .default property depending on build. Let's handle both safely.
  private gitignorePath: string;

  constructor(
    private workspaceRoot: string,
    private index: WorkspaceIndex
  ) {
    this.workspaceRoot = path.resolve(workspaceRoot);
    this.gitignorePath = path.join(this.workspaceRoot, ".gitignore");
    this.loadGitignore();
  }

  private loadGitignore(): void {
    // Create new ignore instance
    const igInstance = ignore.default ? ignore.default() : (ignore as any)();
    
    // Always ignore node_modules, dist, and .git
    igInstance.add([".git", "node_modules", "dist"]);

    try {
      if (fs.existsSync(this.gitignorePath)) {
        const content = fs.readFileSync(this.gitignorePath, "utf-8");
        igInstance.add(content);
      }
    } catch (err) {
      console.error(`Failed to read .gitignore at ${this.gitignorePath}:`, err);
    }

    this.ig = igInstance;
  }

  /**
   * Starts the workspace watcher. The returned promise resolves when the initial
   * scan has completed and the index is populated.
   */
  public start(): Promise<void> {
    return new Promise((resolve) => {
      const ignoredFilter = (absPath: string) => {
        const relPath = path.relative(this.workspaceRoot, absPath);
        if (!relPath) return false; // Do not ignore the workspace root itself
        return this.ig.ignores(relPath);
      };

      this.watcher = chokidar.watch(this.workspaceRoot, {
        ignored: ignoredFilter,
        persistent: true,
        ignoreInitial: false, // Run initially to index all existing files
      });

      this.watcher.on("add", (filePath) => this.handleFileChange(filePath));
      this.watcher.on("change", (filePath) => this.handleFileChange(filePath));
      this.watcher.on("unlink", (filePath) => this.handleFileDelete(filePath));

      // Reload ignore rules if .gitignore changes
      this.watcher.on("change", (filePath) => {
        if (filePath === this.gitignorePath) {
          console.error(".gitignore changed. Re-loading ignore rules...");
          this.loadGitignore();
        }
      });

      this.watcher.on("ready", () => {
        console.error("Workspace indexing: Initial scan complete.");
        resolve();
      });
    });
  }

  private handleFileChange(filePath: string): void {
    const ext = path.extname(filePath);
    if (![".ts", ".js", ".tsx", ".vue"].includes(ext)) {
      return;
    }

    try {
      let exports: string[] = [];
      if (ext === ".vue") {
        exports = parseVueFile(filePath);
      } else {
        exports = parseTsFile(filePath);
      }

      this.index.updateFile(filePath, exports);
    } catch (err) {
      console.error(`Error parsing file ${filePath} in watcher:`, err);
    }
  }

  private handleFileDelete(filePath: string): void {
    const ext = path.extname(filePath);
    if (![".ts", ".js", ".tsx", ".vue"].includes(ext)) {
      return;
    }

    try {
      this.index.removeFile(filePath);
    } catch (err) {
      console.error(`Error removing file ${filePath} in watcher:`, err);
    }
  }

  /**
   * Checks if an absolute file path is ignored by gitignore/workspace rules.
   */
  public isIgnored(absolutePath: string): boolean {
    const relPath = path.relative(this.workspaceRoot, absolutePath);
    if (!relPath) return false;
    return this.ig.ignores(relPath);
  }

  /**
   * Stops the watcher.
   */
  public async stop(): Promise<void> {
    if (this.watcher) {
      await this.watcher.close();
    }
  }
}
