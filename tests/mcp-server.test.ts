import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawn, ChildProcessWithoutNullStreams } from "child_process";
import * as fs from "fs";
import * as path from "path";

describe("MCP Server JSON-RPC End-to-End", () => {
  const testWorkspace = path.resolve("./tests-mcp-workspace");
  let serverProcess: ChildProcessWithoutNullStreams;
  let requestId = 1;

  beforeAll(() => {
    if (fs.existsSync(testWorkspace)) {
      fs.rmSync(testWorkspace, { recursive: true, force: true });
    }
    fs.mkdirSync(testWorkspace, { recursive: true });
    fs.writeFileSync(
      path.join(testWorkspace, "index.ts"),
      "export function runTest() {}"
    );
  });

  afterAll(async () => {
    if (serverProcess) {
      serverProcess.kill("SIGTERM");
    }
    if (fs.existsSync(testWorkspace)) {
      fs.rmSync(testWorkspace, { recursive: true, force: true });
    }
  });

  function sendRequest(method: string, params: any): Promise<any> {
    return new Promise((resolve, reject) => {
      const id = requestId++;
      const request = {
        jsonrpc: "2.0",
        id,
        method,
        params,
      };

      let buffer = "";
      const onData = (data: Buffer) => {
        buffer += data.toString();
        
        // Split by newlines as MCP stdio uses newline-delimited JSON-RPC
        if (buffer.includes("\n")) {
          const lines = buffer.split("\n");
          for (let i = 0; i < lines.length - 1; i++) {
            const line = lines[i].trim();
            if (!line) continue;
            try {
              const response = JSON.parse(line);
              if (response.id === id) {
                serverProcess.stdout.off("data", onData);
                resolve(response);
                return;
              }
            } catch (err) {
              // Incomplete line, continue buffering
            }
          }
          buffer = lines[lines.length - 1];
        }
      };

      serverProcess.stdout.on("data", onData);
      serverProcess.stdin.write(JSON.stringify(request) + "\n");
    });
  }

  it("should respond to tools/list and tools/call", async () => {
    // Start the compiled server process with the test workspace argument
    serverProcess = spawn("node", ["dist/index.js", testWorkspace]);

    // Handle stderr to avoid buffering blocks
    serverProcess.stderr.on("data", (data) => {
      // Debug logs from stderr can be viewed if needed
    });

    // Wait a moment for server and watcher initialization
    await new Promise((r) => setTimeout(r, 1200));

    // 1. Test tools/list
    const listResponse = await sendRequest("tools/list", {});
    expect(listResponse.result).toBeDefined();
    expect(listResponse.result.tools).toHaveLength(4);
    const toolNames = listResponse.result.tools.map((t: any) => t.name);
    expect(toolNames).toContain("find_symbol");
    expect(toolNames).toContain("list_directory");
    expect(toolNames).toContain("read_file");
    expect(toolNames).toContain("read_file_snippet");

    // 2. Test find_symbol (exact match)
    const findResponse = await sendRequest("tools/call", {
      name: "find_symbol",
      arguments: { symbol_name: "runTest" },
    });
    
    expect(findResponse.result).toBeDefined();
    expect(findResponse.result.content[0].type).toBe("text");
    const matches = JSON.parse(findResponse.result.content[0].text);
    expect(matches[0].symbol).toBe("runTest");
    expect(matches[0].paths).toContain("index.ts");

    // 3. Test list_directory
    const listDirResponse = await sendRequest("tools/call", {
      name: "list_directory",
      arguments: { path: "." },
    });
    expect(listDirResponse.result).toBeDefined();
    const items = JSON.parse(listDirResponse.result.content[0].text);
    expect(items).toContainEqual(
      expect.objectContaining({
        name: "index.ts",
        type: "file",
      })
    );

    // 4. Test read_file_snippet
    const readSnippetResponse = await sendRequest("tools/call", {
      name: "read_file_snippet",
      arguments: { path: "index.ts", start_line: 1, end_line: 1 },
    });
    expect(readSnippetResponse.result).toBeDefined();
    expect(readSnippetResponse.result.content[0].text).toBe(
      "export function runTest() {}"
    );

    // 5. Test path traversal block
    const traversalResponse = await sendRequest("tools/call", {
      name: "read_file",
      arguments: { path: "../outside.ts" },
    });
    expect(traversalResponse.result).toBeDefined();
    expect(traversalResponse.result.isError).toBe(true);
    expect(traversalResponse.result.content[0].text).toContain("Access denied");
  });
});
