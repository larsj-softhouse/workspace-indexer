import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { WorkspaceIndex } from "./indexer/state.js";
import { WorkspaceWatcher } from "./indexer/watcher.js";
import { validatePath } from "./security/path-validator.js";
import * as fs from "fs";
import * as path from "path";

// 1. Determine the workspace root directory.
// We accept it as the first argument, or default to the current working directory.
const workspaceRoot = path.resolve(process.argv[2] || process.cwd());
console.error(`[workspace-indexer] Starting server for workspace root: ${workspaceRoot}`);

// 2. Initialize our Workspace Index and Watcher
const index = new WorkspaceIndex(workspaceRoot);
const watcher = new WorkspaceWatcher(workspaceRoot, index);

// Start the watcher/indexer in the background
watcher.start()
  .then(() => {
    console.error(
      `[workspace-indexer] Initial index complete. Files: ${index.getFileCount()}, Symbols: ${index.getSymbolCount()}`
    );
  })
  .catch((err) => {
    console.error(`[workspace-indexer] Failed during initial workspace index:`, err);
  });

// 3. Initialize the MCP Server
const server = new Server(
  {
    name: "workspace-indexer",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// 4. Register the list of available tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "find_symbol",
        description:
          "Find the exact file path where a symbol (function, class, variable, etc.) is exported in the workspace. Fallbacks to fuzzy matching if exact match fails.",
        inputSchema: {
          type: "object",
          properties: {
            symbol_name: {
              type: "string",
              description: "The name of the exported symbol to search for.",
            },
          },
          required: ["symbol_name"],
        },
      },
      {
        name: "list_directory",
        description:
          "List the contents of a directory in the workspace, respecting ignore rules.",
        inputSchema: {
          type: "object",
          properties: {
            path: {
              type: "string",
              description: "The directory path relative to the workspace root. Use empty string or '.' for root.",
            },
          },
          required: ["path"],
        },
      },
      {
        name: "read_file",
        description:
          "Read the full contents of a file in the workspace (500KB size limit).",
        inputSchema: {
          type: "object",
          properties: {
            path: {
              type: "string",
              description: "The file path relative to the workspace root.",
            },
          },
          required: ["path"],
        },
      },
      {
        name: "read_file_snippet",
        description:
          "Read a specific line range from a file. Saves token context window space.",
        inputSchema: {
          type: "object",
          properties: {
            path: {
              type: "string",
              description: "The file path relative to the workspace root.",
            },
            start_line: {
              type: "integer",
              description: "The 1-indexed starting line number (inclusive).",
            },
            end_line: {
              type: "integer",
              description: "The 1-indexed ending line number (inclusive).",
            },
          },
          required: ["path", "start_line", "end_line"],
        },
      },
    ],
  };
});

// 5. Handle tool execution requests
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case "find_symbol": {
        const { symbol_name } = args as { symbol_name: string };
        if (!symbol_name) {
          throw new Error("Missing 'symbol_name' parameter.");
        }
        const matches = index.findSymbol(symbol_name);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(matches, null, 2),
            },
          ],
        };
      }

      case "list_directory": {
        const { path: targetPath } = args as { path: string };
        const resolvedPath = validatePath(workspaceRoot, targetPath || ".");

        const stats = fs.statSync(resolvedPath);
        if (!stats.isDirectory()) {
          throw new Error(`Path "${targetPath}" is not a directory.`);
        }

        const entries = fs.readdirSync(resolvedPath, { withFileTypes: true });
        const items = [];

        for (const entry of entries) {
          const entryPath = path.join(resolvedPath, entry.name);
          const isDir = entry.isDirectory();

          // Skip if ignored by .gitignore / watcher rules
          if (watcher.isIgnored(entryPath)) {
            continue;
          }

          items.push({
            name: entry.name,
            type: isDir ? "directory" : "file",
            path: path.relative(workspaceRoot, entryPath),
          });
        }

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(items, null, 2),
            },
          ],
        };
      }

      case "read_file": {
        const { path: targetPath } = args as { path: string };
        const resolvedPath = validatePath(workspaceRoot, targetPath);

        const stats = fs.statSync(resolvedPath);
        if (!stats.isFile()) {
          throw new Error(`Path "${targetPath}" is not a file.`);
        }

        const MAX_SIZE = 1024 * 500; // 500 KB limit
        if (stats.size > MAX_SIZE) {
          throw new Error(
            `File is too large (${(stats.size / 1024).toFixed(
              1
            )}KB). Please use 'read_file_snippet' to view specific parts.`
          );
        }

        const content = fs.readFileSync(resolvedPath, "utf-8");
        return {
          content: [
            {
              type: "text",
              text: content,
            },
          ],
        };
      }

      case "read_file_snippet": {
        const { path: targetPath, start_line, end_line } = args as {
          path: string;
          start_line: number;
          end_line: number;
        };

        const resolvedPath = validatePath(workspaceRoot, targetPath);

        if (start_line < 1 || end_line < start_line) {
          throw new Error(
            `Invalid line range: start_line (${start_line}) must be >= 1, and end_line (${end_line}) must be >= start_line.`
          );
        }

        const stats = fs.statSync(resolvedPath);
        if (!stats.isFile()) {
          throw new Error(`Path "${targetPath}" is not a file.`);
        }

        const content = fs.readFileSync(resolvedPath, "utf-8");
        const lines = content.split(/\r?\n/);

        // slice is 0-indexed, start_line is 1-indexed (so start_line - 1), end_line is inclusive
        const snippetLines = lines.slice(start_line - 1, end_line);

        return {
          content: [
            {
              type: "text",
              text: snippetLines.join("\n"),
            },
          ],
        };
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (err: any) {
    return {
      content: [
        {
          type: "text",
          text: `Error: ${err.message}`,
        },
      ],
      isError: true,
    };
  }
});

// 6. Connect the server using standard input/output transport
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[workspace-indexer] MCP server running on stdio.");
}

main().catch((err) => {
  console.error("[workspace-indexer] Fatal error in main loop:", err);
  process.exit(1);
});

// 7. Cleanup watcher on exit signals
const cleanup = async () => {
  console.error("[workspace-indexer] Shutting down watcher...");
  await watcher.stop();
  process.exit(0);
};

process.on("SIGINT", cleanup);
process.on("SIGTERM", cleanup);
