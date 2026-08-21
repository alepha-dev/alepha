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
 *
 * Registry paths are not all components: `@/registry/<style>/ui/button` is one,
 * but `@/registry/<style>/lib/utils` and `.../hooks/*` sit next to `components/`
 * in our `src/`, not under it.
 */
const rewriteImports = (content) =>
  content
    .replaceAll(
      /from(\s+)["']@\/registry\/[^/]+\/(ui\/[^"']+)["']/g,
      'from$1"@alepha/ui/components/$2"',
    )
    .replaceAll(
      /from(\s+)["']@\/registry\/[^/]+\/((?:lib|hooks)\/[^"']+)["']/g,
      'from$1"@alepha/ui/$2"',
    )
    .replaceAll(
      /from\s+["']@\/(components|lib|hooks)\/?/g,
      'from "@alepha/ui/$1/',
    );

/**
 * The base-nova registry ships icons wrapped in `<IconPlaceholder>`, a
 * scaffolding component from the shadcn website that lets the docs preview the
 * same block across icon libraries. It is not part of the published registry,
 * so it must be resolved to a concrete library at sync time — we use
 * `lucide-react`, already a dependency.
 *
 *   <IconPlaceholder lucide="XIcon" tabler="IconX" … className="size-4" />
 *     becomes
 *   <XIcon className="size-4" />
 */
const ICON_LIBS = ["lucide", "tabler", "hugeicons", "phosphor", "remixicon"];

const resolveIconPlaceholders = (content) => {
  const used = new Set();
  const next = content.replaceAll(
    /<IconPlaceholder\s([^>]*?)\/>/g,
    (match, rawAttrs) => {
      const icon = rawAttrs.match(/lucide=["']([^"']+)["']/)?.[1];
      if (!icon) return match;
      used.add(icon);
      const rest = ICON_LIBS.reduce(
        (attrs, lib) =>
          attrs.replaceAll(new RegExp(`\\s*${lib}=["'][^"']*["']`, "g"), ""),
        rawAttrs,
      ).trim();
      return rest ? `<${icon} ${rest} />` : `<${icon} />`;
    },
  );
  if (!used.size) return next;
  const names = [...used]
    .sort((a, b) => String(a).localeCompare(String(b)))
    .join(", ");
  return next.replace(
    /import\s+\{\s*IconPlaceholder\s*\}\s+from\s+["'][^"']*icon-placeholder["'];?\n?/,
    `import { ${names} } from "lucide-react";\n`,
  );
};

/**
 * Deliberate divergences from upstream, re-applied on every sync.
 *
 * This is the only durable place for them. `writeFiles` overwrites each stock
 * primitive wholesale, so an edit made in `src/components/ui/*.tsx` — comment
 * included — is gone the next time this script runs. A patch here is not.
 *
 * Each entry is `[registry-relative file, find, replace, why]`. A `find` that
 * stops matching is reported loudly rather than skipped: a divergence that
 * silently stopped applying is worse than one that was never made.
 */
const LOCAL_PATCHES = [
  [
    "ui/dropdown-menu.tsx",
    "w-(--anchor-width) min-w-32",
    "w-auto max-w-(--available-width) min-w-32",
    "a menu is not a select: sizing it to a 32px icon trigger wrapped every label past min-w-32; max-w keeps w-auto from running off the viewport",
  ],
];

const applyLocalPatches = (rel, content) => {
  let next = content;
  for (const [file, find, replace, why] of LOCAL_PATCHES) {
    if (file !== rel) continue;
    if (!next.includes(find)) {
      console.warn(
        `\x1b[33m!\x1b[0m local patch no longer applies to ${rel} — ${why}\n  looked for: ${find}`,
      );
      continue;
    }
    next = next.replaceAll(find, replace);
    log(`patched ${rel} — ${why}`);
  }
  return next;
};

/**
 * Resolve where a registry file lands under `src/`.
 *
 * `registry:ui` items carry no `target` — only a registry-relative `path`
 * such as `registry/base-nova/ui/button.tsx`, which maps to
 * `src/components/ui/button.tsx`. Items that do set an explicit `target`
 * (hooks, lib helpers) keep using it verbatim.
 */
const destOf = (file) => {
  if (file.target) return join(srcDir, file.target);
  const rel = file.path.replace(/^registry\/[^/]+\//, "");
  return join(srcDir, "components", rel);
};

const relOf = (file) =>
  file.target ? file.target : file.path.replace(/^registry\/[^/]+\//, "");

const writeFiles = (item) => {
  for (const file of item.files ?? []) {
    if (!file.path && !file.target) continue;
    const dest = destOf(file);
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(
      dest,
      applyLocalPatches(
        relOf(file),
        resolveIconPlaceholders(rewriteImports(file.content)),
      ),
    );
  }
};

/**
 * Fetch a registry item. Returns `null` on 404 so that our own components
 * living in `src/components/ui/` (e.g. `segmented`) — which the upstream
 * registry does not know about — are skipped instead of aborting the run.
 */
const fetchJson = async (url) => {
  const r = await fetch(url);
  if (r.status === 404) return null;
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
const results = await Promise.all(
  stock.map(async (name) => [
    name,
    await fetchJson(`${SHADCN_BASE}/${name}.json`),
  ]),
);
const skipped = results.filter(([, item]) => !item).map(([name]) => name);
if (skipped.length) {
  log(`Not in registry, left untouched: ${skipped.join(", ")}`);
}
for (const [, item] of results) {
  if (item) writeFiles(item);
}

log("Linting and formatting with oxlint + oxfmt…");
run("yarn", ["oxlint", "--fix", "packages/@alepha/ui/src"], { cwd: repoRoot });
run("yarn", ["oxfmt", "packages/@alepha/ui/src"], { cwd: repoRoot });

log("Sync complete.");
