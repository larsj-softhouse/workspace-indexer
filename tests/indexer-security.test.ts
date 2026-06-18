import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { validatePath } from "../src/security/path-validator.js";
import { WorkspaceIndex } from "../src/indexer/state.js";
import { WorkspaceWatcher } from "../src/indexer/watcher.js";
import * as fs from "fs";
import * as path from "path";

describe("Path Traversal Security", () => {
  const workspaceRoot = "/workspace/project";

  it("should allow paths inside workspace root", () => {
    expect(() =>
      validatePath(workspaceRoot, "src/components/Button.vue")
    ).not.toThrow();
    expect(() => validatePath(workspaceRoot, "./index.ts")).not.toThrow();
    expect(validatePath(workspaceRoot, "src/components/Button.vue")).toBe(
      path.resolve(workspaceRoot, "src/components/Button.vue")
    );
  });

  it("should catch and throw on path traversal attempts escaping the workspace", () => {
    expect(() => validatePath(workspaceRoot, "../../../etc/passwd")).toThrow(
      /Access denied/
    );
    expect(() => validatePath(workspaceRoot, "/etc/passwd")).toThrow(
      /Access denied/
    );
    expect(() => validatePath(workspaceRoot, "src/../../outside.ts")).toThrow(
      /Access denied/
    );
    expect(() => validatePath(workspaceRoot, "../project-secret/file.txt")).toThrow(
      /Access denied/
    );
  });
});

describe("Indexer Logic", () => {
  it("should update, remove and query symbols correctly", () => {
    const root = "/workspace/project";
    const index = new WorkspaceIndex(root);

    index.updateFile("src/math.ts", ["add", "subtract", "multiply"]);
    index.updateFile("src/string.ts", ["concat", "split"]);

    // Exact search
    const match1 = index.findSymbol("add");
    expect(match1).toHaveLength(1);
    expect(match1[0].symbol).toBe("add");
    expect(match1[0].paths).toContain("src/math.ts");

    // Multiple exports of same name
    index.updateFile("src/calc.ts", ["add", "divide"]);
    const match2 = index.findSymbol("add");
    expect(match2).toHaveLength(1);
    expect(match2[0].paths).toContain("src/math.ts");
    expect(match2[0].paths).toContain("src/calc.ts");

    // Remove file
    index.removeFile("src/math.ts");
    const match3 = index.findSymbol("add");
    expect(match3[0].paths).not.toContain("src/math.ts");
    expect(match3[0].paths).toContain("src/calc.ts");

    // Fuzzy search fallback
    const matchFuzzy = index.findSymbol("conca"); // matches "concat"
    expect(matchFuzzy).toHaveLength(1);
    expect(matchFuzzy[0].symbol).toBe("concat");
    expect(matchFuzzy[0].paths).toContain("src/string.ts");
  });
});

describe("Workspace Watcher Integration", () => {
  const testDir = path.resolve("./tests-temp-workspace");
  let index: WorkspaceIndex;
  let watcher: WorkspaceWatcher;

  beforeAll(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
    fs.mkdirSync(testDir, { recursive: true });
  });

  afterAll(async () => {
    if (watcher) {
      await watcher.stop();
    }
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  it("should index files, detect updates/deletes and respect .gitignore", async () => {
    // Write some initial files
    fs.mkdirSync(path.join(testDir, "src"), { recursive: true });
    fs.writeFileSync(
      path.join(testDir, "src/main.ts"),
      "export const hello = () => {};"
    );
    fs.writeFileSync(
      path.join(testDir, "src/utils.ts"),
      "export function format() {}"
    );

    // Write .gitignore and an ignored file
    fs.writeFileSync(
      path.join(testDir, ".gitignore"),
      "ignored-file.ts\nnode_modules\n"
    );
    fs.writeFileSync(
      path.join(testDir, "ignored-file.ts"),
      "export const secret = 1;"
    );

    index = new WorkspaceIndex(testDir);
    watcher = new WorkspaceWatcher(testDir, index);

    // Start watching and wait for initial scan to complete
    await watcher.start();

    // Verify initial scan
    expect(index.getFileCount()).toBe(2);
    expect(index.findSymbol("hello")[0]?.paths).toContain("src/main.ts");
    expect(index.findSymbol("format")[0]?.paths).toContain("src/utils.ts");
    // Ignored file should not be in the index
    expect(index.findSymbol("secret")).toHaveLength(0);

    // Simulate file update
    fs.writeFileSync(
      path.join(testDir, "src/main.ts"),
      "export const hello = () => {}; export const goodbye = 1;"
    );
    // Wait briefly for file change event to propagate
    await new Promise((r) => setTimeout(r, 400));

    expect(index.findSymbol("goodbye")[0]?.paths).toContain("src/main.ts");

    // Simulate file deletion
    fs.unlinkSync(path.join(testDir, "src/utils.ts"));
    // Wait briefly for unlink event to propagate
    await new Promise((r) => setTimeout(r, 400));

    expect(index.findSymbol("format")).toHaveLength(0);
  });
});
