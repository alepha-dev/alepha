import { access, readFile } from "node:fs/promises";
import { join } from "node:path";
import { AlephaError } from "../errors/AlephaError.ts";

/**
 * Remember:
 * At first, functions was inside alepha/vite package, but it's now used in alepha/cli too.
 * For avoiding cli -> vite, all code moved here.
 */

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
 */
const getServerEntry = async (root = process.cwd()): Promise<string> => {
  const pkgPath = join(root, "package.json");
  try {
    const pkg = JSON.parse(await readFile(pkgPath, "utf-8"));
    if (pkg.main) {
      const mainPath = join(root, pkg.main);
      await access(mainPath);
      return mainPath.replace(/\\/g, "/");
    }
  } catch {
    // continue to next step
  }

  const maybeEntry = [
    "src/index.server.ts",
    "src/main.server.ts",
    "src/server-entry.ts",
    "src/index.server.tsx",
    "src/main.server.tsx",
    "src/server-entry.tsx",
  ];

  for (const entry of maybeEntry) {
    try {
      await access(entry);
      return join(root, entry).replace(/\\/g, "/");
    } catch {
      // continue to next entry
    }
  }

  const clientEntry = await getClientEntry(root);
  if (clientEntry) {
    return clientEntry;
  }

  throw new AlephaError(
    `Could not find a server entry file. Please declare your server entry in package.json "main" field.`,
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
