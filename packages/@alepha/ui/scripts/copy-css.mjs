#!/usr/bin/env node
import { cp, mkdir, readdir } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Copy stylesheets from `src/` into `dist/`, preserving their paths.
 *
 * `tsdown` leaves `.css` imports external (see `tsdown.config.ts`), so the
 * emitted `markdown-view.js` still carries `import "./markdown-view.css"`.
 * That specifier is relative, so the file has to exist beside it in `dist/`
 * or the import resolves to nothing.
 *
 * `styles.css` is copied for symmetry, but the published `exports` map still
 * points `./styles.css` at the copy in `src/`: it ends in
 * `@source "../**\/*.{ts,tsx}"`, which is how Tailwind discovers the class
 * names used by the components. Tailwind needs to read the sources to do that,
 * and `dist/` holds `.js`.
 */
const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const walk = async (dir) => {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walk(path)));
    } else if (entry.name.endsWith(".css")) {
      files.push(path);
    }
  }
  return files;
};

const src = join(root, "src");
const stylesheets = await walk(src);

for (const file of stylesheets) {
  const target = join(root, "dist", relative(src, file));
  await mkdir(dirname(target), { recursive: true });
  await cp(file, target);
}

console.log(`copied ${stylesheets.length} stylesheet(s) to dist/`);
