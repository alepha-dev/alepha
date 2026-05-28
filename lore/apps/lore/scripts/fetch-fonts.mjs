#!/usr/bin/env node
// One-shot: download Google Fonts CSS + woff2 subsets into public/fonts/,
// rewrite gstatic URLs to local paths. Re-run when ThemesProvider font list changes.
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const THEMES = [
  {
    id: "default",
    url: "https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600&display=swap",
  },
  {
    id: "tavern",
    url: "https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@500;700&family=EB+Garamond:wght@400;600&display=swap",
  },
  {
    id: "sylvan",
    url: "https://fonts.googleapis.com/css2?family=Spectral:wght@400;500;600&display=swap",
  },
  {
    id: "arcane",
    url: "https://fonts.googleapis.com/css2?family=Cinzel:wght@500;700&display=swap",
  },
  {
    id: "forge",
    url: "https://fonts.googleapis.com/css2?family=Cinzel:wght@500;700&display=swap",
  },
  {
    id: "frost",
    url: "https://fonts.googleapis.com/css2?family=Marcellus&family=Spectral:wght@400;500&display=swap",
  },
];

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, "..", "public", "fonts");
const FILES_DIR = join(OUT_DIR, "files");

await mkdir(FILES_DIR, { recursive: true });

const downloaded = new Map(); // remote URL -> local filename

async function download(remote) {
  if (downloaded.has(remote)) return downloaded.get(remote);
  // Filename: /s/<family>/<version>/<hash>.woff2 -> <family>-<hash>.woff2
  const m = remote.match(/\/s\/([^/]+)\/[^/]+\/([^/]+\.woff2)$/);
  const name = m ? `${m[1]}-${m[2]}` : remote.split("/").pop();
  const local = `/fonts/files/${name}`;
  const res = await fetch(remote);
  if (!res.ok) throw new Error(`fetch ${remote} -> ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  await writeFile(join(FILES_DIR, name), buf);
  downloaded.set(remote, local);
  return local;
}

for (const theme of THEMES) {
  console.log(`[${theme.id}] fetching CSS`);
  const res = await fetch(theme.url, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`CSS ${theme.url} -> ${res.status}`);
  let css = await res.text();
  const urls = [
    ...css.matchAll(/https:\/\/fonts\.gstatic\.com\/[^)]+\.woff2/g),
  ].map((m) => m[0]);
  const unique = [...new Set(urls)];
  console.log(`[${theme.id}] ${unique.length} woff2 files`);
  for (const u of unique) {
    const local = await download(u);
    css = css.split(u).join(local);
  }
  await writeFile(join(OUT_DIR, `${theme.id}.css`), css);
}

console.log(
  `Done. ${downloaded.size} unique woff2 files in public/fonts/files/`,
);
