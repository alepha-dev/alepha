import { access, readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { AlephaError } from "alepha";

/**
 * Remember:
 * At first, functions was inside alepha/vite package, but it's now used in alepha too.
 * For avoiding cli -> vite, all code moved here.
 */

/**
 * Server entry files in priority order.
 * main.server.ts is preferred over main.ts for consistency.
 */
const SERVER_ENTRIES = [
  "main.server.ts",
  "main.server.tsx",
  "main.ts",
  "main.tsx",
] as const;

/**
 * Find browser/client entry file path.
 */
const getClientEntry = async (
  root = process.cwd(),
): Promise<string | undefined> => {
  const indexPath = join(root, "index.html");
  try {
    const html = await readFile(indexPath, "utf8");
    return extractFirstModuleScriptSrc(html).replace(/\\/g, "/");
  } catch {
    return undefined;
  }
};

/**
 * Find server entry file path.
 *
 * Optimized to use a single readdir() call instead of multiple access() calls.
 */
const getServerEntry = async (
  root = process.cwd(),
  explicitEntry?: string,
): Promise<string> => {
  if (explicitEntry) {
    const explicitPath = join(root, explicitEntry);
    try {
      await access(explicitPath);
      return explicitPath;
    } catch {
      throw new AlephaError(
        `Explicit server entry file "${explicitEntry}" not found.`,
      );
    }
  }

  // Single IO: read src/ directory listing
  const srcDir = join(root, "src");
  try {
    const files = new Set(await readdir(srcDir));

    // Find first matching entry in priority order
    for (const entry of SERVER_ENTRIES) {
      if (files.has(entry)) {
        return join(srcDir, entry).replace(/\\/g, "/");
      }
    }
  } catch {
    // src/ directory doesn't exist, fall through to client entry
  }

  // Fallback: try client entry from index.html
  const clientEntry = await getClientEntry(root);
  if (clientEntry) {
    return clientEntry;
  }

  const fullPaths = SERVER_ENTRIES.map((e) => `src/${e}`);
  throw new AlephaError(
    `Could not find a server entry file. Supported entries: ${fullPaths.join(", ")}`,
  );
};

/**
 * Extract first module script src from HTML.
 */
function extractFirstModuleScriptSrc(html: string): string {
  const scriptRegex = /<script\b[^>]*>[\s\S]*?<\/script>/gi;
  let match: RegExpExecArray | null = scriptRegex.exec(html);

  while (match) {
    const tag = match[0];

    // Check for type="module"
    if (/type=["']module["']/i.test(tag)) {
      // Extract the src value
      const srcMatch = tag.match(/\bsrc=["']([^"']+)["']/i);
      const entry = srcMatch?.[1];
      if (entry) {
        if (entry.startsWith("/")) {
          return entry.substring(1); // Remove leading slash
        }
        return entry;
      }
    }

    match = scriptRegex.exec(html);
  }

  throw new AlephaError(`No module script found in the provided HTML.`);
}

export const boot = {
  getClientEntry,
  getServerEntry,
};
