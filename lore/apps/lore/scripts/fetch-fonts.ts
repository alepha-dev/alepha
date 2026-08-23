#!/usr/bin/env node --experimental-strip-types
/**
 * One-shot: download Google Fonts CSS + woff2 subsets into public/fonts/,
 * rewrite gstatic URLs to local paths, strip non-Latin charsets to save
 * bytes. Re-run when ThemesProvider font list changes:
 *
 *   yarn fonts
 *
 * What it does:
 *   1. Pre-clean public/fonts/ so stale themes evaporate.
 *   2. For each theme: fetch CSS, drop every @font-face block whose
 *      preceding charset comment is not `latin` or `latin-ext`, download
 *      only the woff2 files that survive the filter.
 *   3. Cross-check against ThemesProvider.ts — every fontHref declared
 *      there must map to a CSS file we just generated.
 *
 * UA spoof: Google serves woff (older) or woff2 (modern) based on UA;
 * pinning a recent Chrome UA forces woff2.
 */
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const KEEP_CHARSETS = new Set(["latin", "latin-ext"]);

interface Theme {
  id: string;
  url: string;
}

const THEMES: Theme[] = [
  {
    id: "default",
    url: "https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600&display=swap",
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
    id: "frost",
    url: "https://fonts.googleapis.com/css2?family=Marcellus&family=Spectral:wght@400;500&display=swap",
  },
];

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..");
const OUT_DIR = join(REPO_ROOT, "public", "fonts");
const FILES_DIR = join(OUT_DIR, "files");
const THEMES_PROVIDER = join(
  REPO_ROOT,
  "src/web/app/services/ThemesProvider.ts",
);

// Only the theme stylesheets are regenerated here. `public/fonts/` also
// holds `folio.css` and the Literata / JetBrains Mono files behind it, which
// are hand-placed: a recursive wipe used to delete them on every run.
for (const theme of THEMES) {
  await rm(join(OUT_DIR, `${theme.id}.css`), { force: true });
}
await mkdir(FILES_DIR, { recursive: true });

const downloaded = new Map<string, string>(); // remote URL -> local path

async function download(remote: string): Promise<string> {
  const cached = downloaded.get(remote);
  if (cached) return cached;
  const m = remote.match(/\/s\/([^/]+)\/[^/]+\/([^/]+\.woff2)$/);
  if (!m) throw new Error(`unexpected gstatic url: ${remote}`);
  const name = `${m[1]}-${m[2]}`;
  const local = `/fonts/files/${name}`;
  const res = await fetch(remote);
  if (!res.ok) throw new Error(`fetch ${remote} -> ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  await writeFile(join(FILES_DIR, name), buf);
  downloaded.set(remote, local);
  return local;
}

/**
 * Filter Google's CSS down to latin + latin-ext charsets. Each block
 * starts with a `/* <charset> *\/` comment immediately before its
 * `@font-face { ... }` declaration.
 */
function filterCharsets(css: string): string {
  const blocks = css.split(/(?=\/\* [^*]+ \*\/\s*@font-face)/);
  return blocks
    .filter((b) => {
      const m = b.match(/^\/\* ([^*]+) \*\//);
      if (!m) return true; // preamble before first block, keep it
      return KEEP_CHARSETS.has(m[1].trim());
    })
    .join("");
}

for (const theme of THEMES) {
  console.log(`[${theme.id}] fetching CSS`);
  const res = await fetch(theme.url, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`CSS ${theme.url} -> ${res.status}`);
  let css = filterCharsets(await res.text());

  const urls = [
    ...new Set(
      [...css.matchAll(/https:\/\/fonts\.gstatic\.com\/[^)]+\.woff2/g)].map(
        (m) => m[0],
      ),
    ),
  ];
  console.log(`[${theme.id}] ${urls.length} woff2 files (latin only)`);

  for (const u of urls) {
    const local = await download(u);
    css = css.split(u).join(local);
  }
  await writeFile(join(OUT_DIR, `${theme.id}.css`), css);
}

// Cross-check: every fontHref in ThemesProvider.ts must have been generated.
const provider = await readFile(THEMES_PROVIDER, "utf-8");
const declared = new Set(
  [...provider.matchAll(/fontHref:\s*"\/fonts\/([^"]+\.css)"/g)].map(
    (m) => m[1],
  ),
);
const generated = new Set(THEMES.map((t) => `${t.id}.css`));
const missing = [...declared].filter((f) => !generated.has(f));
if (missing.length > 0) {
  throw new Error(
    `ThemesProvider references CSS that this script doesn't generate: ${missing.join(", ")}. Add them to THEMES or fix the fontHref.`,
  );
}

console.log(
  `Done. ${downloaded.size} unique woff2 files in public/fonts/files/`,
);
