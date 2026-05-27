#!/usr/bin/env node
/**
 * Force-resyncs every component in `@alepha/ui` from its source of truth:
 *
 * - Stock shadcn primitives (`button`, `card`, `dialog`, …) are fetched
 *   from the public shadcn registry over HTTP.
 * - Alepha blocks (`alepha-table`, `control/*`, admin pages, auth pages,
 *   …) are read straight from the local registry build output
 *   (`apps/docs/public/r/<name>.json`) which is rebuilt at the start.
 *
 * `@alepha/ui` is a pure mirror: running this should produce no diff
 * unless an upstream component or a registry source has changed.
 *
 * Why we don't shell out to `shadcn add`: with `alepha: workspace:^` in
 * peerDependencies, the CLI hangs forever in `Installing dependencies`
 * when given many components at once. Reading the same JSON the CLI
 * would have read keeps the script instant.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const uiDir = resolve(here, "..");
const repoRoot = resolve(uiDir, "../../..");
const registryDir = resolve(repoRoot, "packages/@alepha/ui-registry");
const registryOutDir = resolve(repoRoot, "apps/docs/public/r");
const srcDir = join(uiDir, "src");

const SHADCN_BASE = "https://ui.shadcn.com/r/styles/base-nova";

const log = (msg) => console.log(`[36m→[0m ${msg}`);

const run = (cmd, args, opts = {}) => {
  const res = spawnSync(cmd, args, { stdio: "inherit", ...opts });
  if (res.status !== 0) {
    throw new Error(`${cmd} ${args.join(" ")} exited with ${res.status}`);
  }
};

/**
 * Translate shadcn-style `@/...` imports to `@alepha/ui/...` paths so
 * generated files compile under our package alias.
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

/**
 * Strip the registry prefix from `target` to get a path under
 * `@alepha/ui/src/`.
 */
const resolveTarget = (target) =>
  join(
    srcDir,
    target.replace(/^components\//, "components/").replace(/^lib\//, "lib/"),
  );

const writeFiles = (item) => {
  for (const file of item.files ?? []) {
    if (!file.target) continue;
    const dest = resolveTarget(file.target);
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, rewriteImports(file.content));
  }
};

const fetchJson = async (url) => {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url} → ${r.status}`);
  return r.json();
};

// 1. Rebuild local registry so `apps/docs/public/r/*.json` is fresh.
log("Building @alepha/ui-registry…");
run("yarn", ["build"], { cwd: registryDir });

// 2. Sync alepha blocks from the local registry output.
const alephaJson = readdirSync(registryOutDir).filter(
  (f) => f.endsWith(".json") && f !== "registry.json",
);
log(`Writing ${alephaJson.length} alepha blocks…`);
const ownedUi = new Set();
for (const f of alephaJson) {
  const item = JSON.parse(readFileSync(join(registryOutDir, f), "utf-8"));
  writeFiles(item);
  for (const file of item.files ?? []) {
    const m = file.target?.match(/^components\/ui\/([^/]+)\.tsx$/);
    if (m) ownedUi.add(m[1]);
  }
}

// 3. Sync the rest of `src/components/ui/*` from the public shadcn
//    registry. Anything the alepha registry already wrote in step 2
//    (e.g. our forked `sonner`, `segmented`) is skipped.
const stock = readdirSync(join(srcDir, "components/ui"))
  .filter((f) => f.endsWith(".tsx"))
  .map((f) => f.replace(/\.tsx$/, ""))
  .filter((name) => !ownedUi.has(name));

log(`Fetching ${stock.length} shadcn primitives…`);
const items = await Promise.all(
  stock.map((name) => fetchJson(`${SHADCN_BASE}/${name}.json`)),
);
for (const item of items) writeFiles(item);

// 4. Format. Run from the repo root so the workspace `biome` binary is
//    found whether the script is launched via `yarn w @alepha/ui sync`
//    or directly.
log("Formatting with biome…");
run("yarn", ["biome", "check", "--fix", "packages/@alepha/ui/src"], {
  cwd: repoRoot,
});

log("Sync complete.");
