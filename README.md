# Workspace Indexer MCP Server

A local Model Context Protocol (MCP) server that indexes workspace exports (`.ts`, `.js`, `.tsx`, and `.vue` files) to help AI coding agents (e.g. connected via Continue or Claude Desktop) quickly navigate, search, and understand your local codebase.

## Features

- **AST Parsing**: Extracts exported functions, classes, and variables using `ts-morph`.
- **Vue SFC Support**: Extracts script tags from Vue Single File Components (including `<script setup>` syntax) using `@vue/compiler-sfc`.
- **Path Security**: Prevents directory traversal attacks by validating all path requests relative to the resolved workspace root.
- **Gitignore Respect**: Uses `chokidar` file watching combined with the `ignore` library to exclude `.git`, `node_modules`, `dist` and any rules configured in the workspace's `.gitignore`.
- **Fuzzy Search Fallback**: Employs `fuse.js` to look up symbol approximations if an exact export match is not found.
- **Token Optimization**: Offers the `read_file_snippet` tool to request specific line ranges, keeping context windows small.

---

## Getting Started

### 1. Installation
Install the project dependencies:
```bash
npm install
```

### 2. Build the Server
Compile the TypeScript code to JavaScript:
```bash
npm run build
```

### 3. Run the Server
Start the stdio-based MCP server by passing the absolute path to your workspace directory as an argument:
```bash
npm start /path/to/your/workspace
```
*(If no path argument is provided, the server defaults to the current working directory).*

---

## Configuration

### Continue
To connect this server to the **Continue** extension, add the following to your `config.json` (typically located in `~/.continue/config.json`):

```json
{
  "mcpServers": {
    "workspace-indexer": {
      "command": "node",
      "args": [
        "/absolute/path/to/workspace-indexer/dist/index.js",
        "/absolute/path/to/your/workspace"
      ]
    }
  }
}
```

### OpenCode
To connect this server to **OpenCode**, add the following definition to your configuration file (typically `opencode.json` or `~/.config/opencode/opencode.json`):

```json
{
  "mcpServers": {
    "workspace-indexer": {
      "type": "stdio",
      "command": "node",
      "args": [
        "/absolute/path/to/workspace-indexer/dist/index.js",
        "/absolute/path/to/your/workspace"
      ],
      "env": {}
    }
  }
}
```

---

## Available Tools

The server registers the following MCP tools:

1. **`find_symbol`**
   - **Description**: Find the exact file path where a symbol (function, class, variable, etc.) is exported in the workspace. Fallbacks to fuzzy matching if exact match fails.
   - **Arguments**:
     - `symbol_name` (string): The name of the exported symbol to search.

2. **`list_directory`**
   - **Description**: List the contents of a directory in the workspace, respecting ignore rules.
   - **Arguments**:
     - `path` (string): The directory path relative to the workspace root. Use `""` or `.` for root.

3. **`read_file`**
   - **Description**: Read the full contents of a file in the workspace (500KB size limit).
   - **Arguments**:
     - `path` (string): The file path relative to the workspace root.

4. **`read_file_snippet`**
   - **Description**: Read a specific line range from a file. Saves token context window space.
   - **Arguments**:
     - `path` (string): The file path relative to the workspace root.
     - `start_line` (integer): The 1-indexed starting line number (inclusive).
     - `end_line` (integer): The 1-indexed ending line number (inclusive).

---

## Testing

Run unit and end-to-end integration tests using Vitest:
```bash
npm test
```
