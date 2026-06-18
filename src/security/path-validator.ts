import * as path from "path";

/**
 * Validates that a target path lies within the workspace root.
 * Resolves the path and checks if it escapes the workspace.
 * 
 * @param workspaceRoot The absolute path to the workspace root.
 * @param targetPath The path to validate (can be relative or absolute).
 * @returns The absolute resolved path if safe.
 * @throws Error if the path is outside the workspace root.
 */
export function validatePath(workspaceRoot: string, targetPath: string): string {
  const resolvedRoot = path.resolve(workspaceRoot);
  const resolvedTarget = path.resolve(resolvedRoot, targetPath);

  const relative = path.relative(resolvedRoot, resolvedTarget);
  const isSafe =
    relative === "" ||
    (!relative.startsWith("..") && !path.isAbsolute(relative));

  if (!isSafe) {
    throw new Error(
      `Access denied: Path traversal detected. Requested path "${targetPath}" is outside workspace root "${workspaceRoot}".`
    );
  }

  return resolvedTarget;
}
