import { Project, SourceFile, Node } from "ts-morph";

// Initialize a single ts-morph Project to be shared for performance
const project = new Project({
  compilerOptions: {
    allowJs: true,
  },
  skipAddingFilesFromTsConfig: true,
  skipFileDependencyResolution: true,
  skipLoadingLibFiles: true,
});

/**
 * Extracts exported symbol names from a SourceFile.
 */
export function getExportNames(sourceFile: SourceFile): string[] {
  const exportNames = new Set<string>();

  try {
    const exportedDeclarations = sourceFile.getExportedDeclarations();
    for (const [name, declarations] of exportedDeclarations) {
      if (name === "default") {
        // For default exports, try to extract the actual name of the class/function/variable
        for (const decl of declarations) {
          if (
            Node.isClassDeclaration(decl) ||
            Node.isFunctionDeclaration(decl) ||
            Node.isInterfaceDeclaration(decl) ||
            Node.isEnumDeclaration(decl) ||
            Node.isTypeAliasDeclaration(decl)
          ) {
            const declName = decl.getName();
            if (declName) {
              exportNames.add(declName);
            }
          } else if (Node.isVariableDeclaration(decl)) {
            const declName = decl.getName();
            if (declName) {
              exportNames.add(declName);
            }
          }
        }
        // Also keep "default" so it's queryable
        exportNames.add("default");
      } else {
        exportNames.add(name);
      }
    }
  } catch (err) {
    console.error(`Error getting exported declarations for ${sourceFile.getFilePath()}:`, err);
  }

  return Array.from(exportNames);
}

/**
 * Parses a TypeScript, JavaScript, or TSX file and returns its exported symbols.
 * 
 * @param filePath The absolute path to the file.
 * @param content Optional file content. If not provided, ts-morph will read it from disk.
 */
export function parseTsFile(filePath: string, content?: string): string[] {
  try {
    let sourceFile: SourceFile;
    
    if (content !== undefined) {
      sourceFile = project.createSourceFile(filePath, content, { overwrite: true });
    } else {
      const existing = project.getSourceFile(filePath);
      if (existing) {
        // Remove and reload to avoid memory leaks/stale representations
        project.removeSourceFile(existing);
      }
      sourceFile = project.addSourceFileAtPath(filePath);
    }
    
    const exports = getExportNames(sourceFile);
    
    // Clean up to keep memory usage minimal
    project.removeSourceFile(sourceFile);
    
    return exports;
  } catch (err) {
    console.error(`Failed to parse TS file ${filePath}:`, err);
    return [];
  }
}
