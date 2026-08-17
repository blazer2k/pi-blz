import { homedir } from "node:os";
import { sep } from "node:path";

export function shortenPath(filePath: string): string {
  const home = homedir();
  const suffix = filePath.slice(home.length);
  const isInsideHome =
    filePath === home ||
    (filePath.startsWith(home) &&
      (suffix.startsWith(sep) || (sep === "\\" && suffix.startsWith("/"))));

  return isInsideHome ? `~${suffix}` : filePath;
}
