export function parseNulSeparatedGitPaths(output: string): string[] {
  if (output.length === 0) return [];
  return output.split("\0").filter((entry) => entry.length > 0);
}
