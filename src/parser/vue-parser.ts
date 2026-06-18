import { parse } from "@vue/compiler-sfc";
import { parseTsFile } from "./ts-parser.js";
import * as path from "path";
import * as fs from "fs";

/**
 * Parses a Vue Single File Component and extracts exported symbol names from its script blocks.
 * Also adds the component name (filename without extension) and "default" as exports.
 * 
 * @param filePath The absolute path to the Vue file.
 * @param content Optional file content. If not provided, will read from disk.
 */
export function parseVueFile(filePath: string, content?: string): string[] {
  const exportNames = new Set<string>();

  try {
    // Determine default component name from filename (e.g. MyComponent.vue -> MyComponent)
    const baseName = path.basename(filePath, ".vue");
    if (baseName) {
      exportNames.add(baseName);
      exportNames.add("default");
    }

    let fileContent = content;
    if (fileContent === undefined) {
      fileContent = fs.readFileSync(filePath, "utf-8");
    }

    const { descriptor } = parse(fileContent, { filename: filePath });

    // Extract exports from standard <script> block
    if (descriptor.script && descriptor.script.content) {
      const scriptExports = parseTsFile(
        `${filePath}.script.ts`,
        descriptor.script.content
      );
      for (const exp of scriptExports) {
        exportNames.add(exp);
      }
    }

    // Extract exports from <script setup> block
    if (descriptor.scriptSetup && descriptor.scriptSetup.content) {
      const setupExports = parseTsFile(
        `${filePath}.setup.ts`,
        descriptor.scriptSetup.content
      );
      for (const exp of setupExports) {
        exportNames.add(exp);
      }
    }
  } catch (err) {
    console.error(`Failed to parse Vue file ${filePath}:`, err);
  }

  return Array.from(exportNames);
}
