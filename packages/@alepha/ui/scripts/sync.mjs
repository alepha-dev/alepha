#!/usr/bin/env node
/**
 * Refresh stock shadcn primitives in `@alepha/ui` from the public shadcn
 * Base UI Nova registry. Our own blocks (alepha-table, control/*, admin/*,
 * auth/*, app-shell, …) are edited directly in `src/components/` and are
 * NOT touched by this script.
 *
 * Run after a shadcn primitive update:
 *   yarn w @alepha/ui sync
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const uiDir = resolve(here, "..");
const repoRoot = resolve(uiDir, "../../..");
const srcDir = join(uiDir, "src");

const SHADCN_BASE = "https://ui.shadcn.com/r/styles/base-nova";

const log = (msg) => console.log(`[36m→[0m ${msg}`);

const run = (cmd, args, opts = {}) => {
  const res = spawnSync(cmd, args, { stdio: "inherit", ...opts });
  if (res.status !== 0) {
    throw new Error(`${cmd} ${args.join(" ")} exited with ${res.status}`);
  }
};

/**
 * Translate shadcn-style `@/...` imports to `@alepha/ui/...` so generated
 * files compile under our package alias.
 */
const rewriteImports = (content) =>
  content
    .replaceAll(
      /from\s+["']@\/registry\/[^/]+\/([^/]+)\/([^"']+)["']/g,
      'from "@alepha/ui/components/$1/$2"',
    )
    .replaceAll(
      /from\s+["']@\/(components|lib|hooks)\/?/g,
      'from "@alepha/ui/$1/',
    );

const writeFiles = (item) => {
  for (const file of item.files ?? []) {
    if (!file.target) continue;
    const dest = join(srcDir, file.target);
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, rewriteImports(file.content));
  }
};

const fetchJson = async (url) => {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url} → ${r.status}`);
  return r.json();
};

// Fetch every primitive currently in src/components/ui/ from the public
// shadcn Base UI Nova registry. Our own blocks live one level up in
// src/components/<name>/ and are not refetched.
const stock = readdirSync(join(srcDir, "components/ui"))
  .filter((f) => f.endsWith(".tsx"))
  .map((f) => f.replace(/\.tsx$/, ""));

log(`Fetching ${stock.length} shadcn primitives…`);
const items = await Promise.all(
  stock.map((name) => fetchJson(`${SHADCN_BASE}/${name}.json`)),
);
for (const item of items) writeFiles(item);

log("Formatting with biome…");
run("yarn", ["biome", "check", "--fix", "packages/@alepha/ui/src"], {
  cwd: repoRoot,
});

log("Sync complete.");
