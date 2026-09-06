#!/usr/bin/env node
/**
 * Refresh stock shadcn primitives in `@alepha/ui` from the public shadcn
 * Base UI Nova registry. Our own blocks (alepha-table, control/*, admin/*,
 * auth/*, app-shell, …) are edited directly in `src/components/` and are
 * NOT touched by this script.
 *
 * Run after a shadcn primitive update:
 *   yarn w @alepha/ui sync
 *
 * Or to see what it would do, without writing anything:
 *   yarn w @alepha/ui sync:check
 *
 * ## What protects the local work
 *
 * Every file this touches is overwritten WHOLESALE, so a change made in
 * `src/components/ui/*.tsx` survives only if it is declared here. Three
 * mechanisms, in order of how much they protect:
 *
 * - {@link KEEP_LOCAL}: the file is not fetched over at all. For divergences
 *   too structural to express as a replacement.
 * - {@link LOCAL_PATCHES}: a find/replace re-applied after the fetch. A `find`
 *   that stops matching ABORTS the run.
 * - {@link LOCAL_COMMENTS}: comments re-inserted after the fetch. Best-effort,
 *   because losing one changes no behaviour.
 *
 * A divergence in none of the three is lost on the next run. `--check` is what
 * makes that visible before it happens rather than weeks later in the UI.
 */
import { type SpawnSyncOptions, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The shape of one file entry inside a registry item, as fetched from the
 * shadcn registry. Untyped upstream (it is JSON over HTTP), so this is only
 * what the script itself reads off it.
 */
interface RegistryFile {
  path?: string;
  target?: string;
  content: string;
}

/**
 * One registry item, e.g. the response for `ui/button.json`.
 */
interface RegistryItem {
  files?: RegistryFile[];
}

const here = dirname(fileURLToPath(import.meta.url));
const uiDir = resolve(here, "..");
const repoRoot = resolve(uiDir, "../../..");
const srcDir = join(uiDir, "src");

const SHADCN_BASE = "https://ui.shadcn.com/r/styles/base-nova";

/**
 * `--check` fetches and renders exactly as a real sync would, writes nothing,
 * and reports what a real sync would do. It is the answer to this script's
 * oldest failure mode: overwriting a hand-maintained file and finding out from
 * the UI weeks later.
 */
const check = process.argv.includes("--check");

/**
 * Where `--check` stages its rendered files. Under the package rather than the
 * OS temp dir so `oxfmt` resolves the repo's `.oxfmtrc.json`: formatted with
 * anything else, every file compares as drifted.
 *
 * Deliberately NOT gitignored. oxfmt honours a nested `.gitignore` whatever
 * `--ignore-path` says, so an ignored scratch directory is one it refuses to
 * format. The directory is removed on every exit path; if a killed run ever
 * leaves one behind, showing up in `git status` is the right outcome.
 */
const SCRATCH_DIR_REL = ".sync-check";

const log = (msg: string): void => console.log(`[36m→[0m ${msg}`);

const run = (
  cmd: string,
  args: string[],
  opts: SpawnSyncOptions = {},
): void => {
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
 *
 * Since 2026-09 the registry no longer goes through `lib/utils` for `cn`: every
 * primitive does `import { cn } from "cn"`, shadcn's own zero-dependency
 * engine that replaced `clsx` + `tailwind-merge`. That import is routed back
 * through `@alepha/ui/lib/utils`, which re-exports it, for two reasons. One
 * import path for `cn` across the tree, stock and hand-maintained alike. And
 * `--check` keeps comparing content: left as-is, the import line alone would
 * list every primitive as drifted, and a list that says everything says
 * nothing. `lib/utils.ts` itself is never fetched: the directory listing below
 * is `ui/*.tsx` only.
 */
const rewriteImports = (content: string): string =>
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
    )
    .replaceAll(/from(\s+)["']cn["']/g, 'from$1"@alepha/ui/lib/utils"');

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

const resolveIconPlaceholders = (content: string): string => {
  const used = new Set<string>();
  const next = content.replaceAll(
    /<IconPlaceholder\s([^>]*?)\/>/g,
    (match: string, rawAttrs: string) => {
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
 * Files this script must NOT overwrite.
 *
 * A `LOCAL_PATCHES` entry below is a find/replace, which only works when the
 * divergence is a short, stable string. These are not: they add whole features
 * (a `loading` button, badge tones, a locale-aware calendar) or wrap upstream
 * code in `useMemo` to satisfy lint rules this repo enforces and the registry
 * does not. Expressed as find/replace they would break on the first upstream
 * reformat, and the break would land as a failed sync rather than as anything
 * a reader could act on.
 *
 * The cost is real and deliberate: these files stop receiving upstream fixes,
 * and updating one means diffing it by hand against `--check` output. That is
 * the trade every hand-maintained fork makes, and it beats losing the work.
 */
const KEEP_LOCAL = new Map([
  [
    "ui/button.tsx",
    "the `loading` prop (spinner overlay, aria-busy, disabled-while-busy, which every submit in the kit relies on)",
  ],
  [
    "ui/badge.tsx",
    "the `tint` variant, the `tone` scale and the exported `BadgeTone` type that consumers map their own vocabulary onto",
  ],
  [
    "ui/calendar.tsx",
    "month and weekday names follow the app's active language through `useI18n` and a date-fns locale map",
  ],
  [
    "ui/chart.tsx",
    "`useMemo` on the context value plus the `restrict-template-expressions` fixes",
  ],
]);

/**
 * Deliberate divergences from upstream, re-applied on every sync.
 *
 * This is the only durable place for them. `writeFiles` overwrites each stock
 * primitive wholesale, so an edit made in `src/components/ui/*.tsx` — comment
 * included — is gone the next time this script runs. A patch here is not.
 *
 * Each entry is `[registry-relative file, find, replace, why]`. A `find` that
 * no longer matches ABORTS the sync: a divergence that silently stopped
 * applying is worse than one that was never made, and this script has already
 * been shipping that failure mode.
 */
const LOCAL_PATCHES = [
  [
    "ui/dropdown-menu.tsx",
    "w-(--anchor-width) min-w-32",
    "w-auto max-w-(--available-width) min-w-32",
    "a menu is not a select: sizing it to a 32px icon trigger wrapped every label past min-w-32; max-w keeps w-auto from running off the viewport",
  ],
  [
    "ui/tooltip.tsx",
    "delay = 0,",
    "delay = 600,",
    "the registry fires a tooltip the instant the pointer touches a trigger; 600ms is Base UI's own default, and the provider's grouping still makes adjacent tooltips instant once one has opened",
  ],
  [
    "ui/table.tsx",
    'cn("[&_tr]:border-b", className)',
    'cn("bg-muted/50 [&_tr]:border-b", className)',
    "the header keeps as a permanent fill the tint a row only borrows on hover: a header is not actionable, so lighting up under the cursor promised an interaction it does not have",
  ],
  [
    "ui/sonner.tsx",
    'import { useTheme } from "next-themes"',
    'import { useColorMode } from "alepha/react/ui"',
    "next-themes is not a dependency here; the colour scheme comes from alepha/react/ui",
  ],
  [
    "ui/sonner.tsx",
    'const { theme = "system" } = useTheme()',
    "const { mode } = useColorMode()",
    "same: read the mode from alepha/react/ui",
  ],
  [
    "ui/sonner.tsx",
    'theme={theme as ToasterProps["theme"]}\n      className="toaster group"',
    'theme={mode as ToasterProps["theme"]}\n      className="toaster group"\n      closeButton',
    "carry the renamed value through, and keep the close button a toast needs when it carries an error worth reading twice",
  ],
  [
    "ui/input-group.tsx",
    '  return (\n    <div\n      role="group"',
    '  return (\n    // Click forwarding to the real control inside; the addon itself is not the\n    // interactive element and the handler bails when a button was hit.\n    // oxlint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-noninteractive-element-interactions\n    <div\n      role="group"',
    "without the directive `jsx-a11y/click-events-have-key-events` and `no-noninteractive-element-interactions` fail the lint step this script runs, so the sync cannot finish",
  ],
  [
    "ui/label.tsx",
    "  return (\n    <label",
    "  return (\n    // Stock shadcn `Label`: `htmlFor` arrives through the spread props, which\n    // the rule cannot follow.\n    // oxlint-disable-next-line jsx-a11y/label-has-associated-control\n    <label",
    "without the directive `jsx-a11y/label-has-associated-control` fails the lint step this script runs, so the sync cannot finish",
  ],
];

/**
 * Comments that explain a local divergence and would be lost with it.
 *
 * Separate from `LOCAL_PATCHES` because they change no behaviour: a stale
 * entry here is worth reporting, not worth aborting a sync over.
 */
const LOCAL_COMMENTS = [
  [
    "ui/dropdown-menu.tsx",
    '            "cn-menu-target cn-menu-translucent',
    '            // The `w-auto` sizing is local. Re-applied by `scripts/sync.ts`,\n            // which carries the reasoning; this file is overwritten wholesale.\n            "cn-menu-target cn-menu-translucent',
  ],
  [
    "ui/tooltip.tsx",
    "  delay = 600,",
    "  // 600ms rather than the registry's 0. Re-applied by `scripts/sync.ts`,\n  // which carries the reasoning; this file is overwritten wholesale.\n  delay = 600,",
  ],
  [
    "ui/table.tsx",
    '      className={cn("bg-muted/50',
    '      // The permanent header tint is local. Re-applied by `scripts/sync.ts`,\n      // which carries the reasoning; this file is overwritten wholesale.\n      className={cn("bg-muted/50',
  ],
  [
    "ui/sidebar.tsx",
    "      document.cookie = `${SIDEBAR_COOKIE_NAME}",
    "      // persist sidebar open-state via cookie (shadcn pattern)\n      document.cookie = `${SIDEBAR_COOKIE_NAME}",
  ],
];

class LocalPatchError extends Error {}

const applyLocalPatches = (rel: string, content: string): string => {
  let next = content;
  for (const [file, find, replace, why] of LOCAL_PATCHES) {
    if (file !== rel) continue;
    if (!next.includes(find)) {
      throw new LocalPatchError(
        `local patch no longer applies to ${rel} — ${why}\n  looked for: ${find}\n` +
          "  Upstream moved. Re-derive the patch against the new file, or move the file to KEEP_LOCAL.",
      );
    }
    next = next.replaceAll(find, replace);
    log(`patched ${rel} — ${why}`);
  }
  for (const [file, find, replace] of LOCAL_COMMENTS) {
    if (file !== rel || !next.includes(find)) continue;
    next = next.replace(find, replace);
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
// `file.path!`: every caller filters out `!file.path && !file.target` first
// (see `planWrites`/`checkFiles`), so a file reaching here without a
// `target` is guaranteed to have a `path` - not provable locally, but true
// by construction.
const destOf = (file: RegistryFile): string => {
  if (file.target) return join(srcDir, file.target);
  const rel = file.path!.replace(/^registry\/[^/]+\//, "");
  return join(srcDir, "components", rel);
};

const relOf = (file: RegistryFile): string =>
  file.target ?? file.path!.replace(/^registry\/[^/]+\//, "");

/**
 * What this script would write for one registry file, or `null` when the file
 * is protected.
 */
const renderFile = (file: RegistryFile): string | null => {
  const rel = relOf(file);
  if (KEEP_LOCAL.has(rel)) return null;
  return applyLocalPatches(
    rel,
    resolveIconPlaceholders(rewriteImports(file.content)),
  );
};

/**
 * Everything a real sync would write, resolved before anything is written.
 *
 * Two passes rather than one because {@link applyLocalPatches} throws: writing
 * as we go would leave the tree half-refreshed on the first stale patch, which
 * is a worse state to hand someone than either the old tree or the new one.
 */
const planWrites = (items: RegistryItem[]): Array<[string, string]> => {
  const plan: Array<[string, string]> = [];
  for (const item of items) {
    for (const file of item.files ?? []) {
      if (!file.path && !file.target) continue;
      const next = renderFile(file);
      if (next == null) {
        log(`kept local ${relOf(file)} — ${KEEP_LOCAL.get(relOf(file))}`);
        continue;
      }
      plan.push([destOf(file), next]);
    }
  }
  return plan;
};

const writeFiles = (plan: Array<[string, string]>): void => {
  for (const [dest, content] of plan) {
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, content);
  }
};

/**
 * Dry run. Renders every file the same way a real sync would, writes nothing
 * into `src/`, and reports two things separately because they need different
 * reactions:
 *
 * - a `LOCAL_PATCHES` entry that no longer applies, or a `KEEP_LOCAL` file that
 *   is not in the tree: the protection is broken and the next sync WILL lose
 *   work. Fails the run.
 * - upstream drift: the registry has moved on for a file we do not protect.
 *   Information, not a failure - taking those updates is what this script is
 *   for. It is listed so `sync` is never the first time anyone sees it.
 *
 * The rendered files go through oxfmt in a scratch directory before being
 * compared. Registry content is unformatted (no semicolons, unsorted imports)
 * while the tree is oxfmt output, so comparing the two directly reported every
 * single file as drifted - a list that says everything and therefore nothing.
 */
interface CheckReport {
  broken: string[];
  protected: string[];
  drift: string[];
}

const checkFiles = (items: RegistryItem[]): CheckReport => {
  const report: CheckReport = { broken: [], protected: [], drift: [] };
  const scratch = join(uiDir, SCRATCH_DIR_REL);
  rmSync(scratch, { recursive: true, force: true });
  mkdirSync(scratch, { recursive: true });
  const pending = [];
  try {
    for (const item of items) {
      for (const file of item.files ?? []) {
        if (!file.path && !file.target) continue;
        const rel = relOf(file);
        let next;
        try {
          next = renderFile(file);
        } catch (error) {
          if (!(error instanceof LocalPatchError)) throw error;
          report.broken.push(error.message);
          continue;
        }
        if (next == null) {
          if (existsSync(destOf(file))) {
            report.protected.push(rel);
          } else {
            report.broken.push(
              `protected file missing from the tree: ${rel} — ${KEEP_LOCAL.get(rel)}`,
            );
          }
          continue;
        }
        const staged = join(scratch, rel);
        mkdirSync(dirname(staged), { recursive: true });
        writeFileSync(staged, next);
        pending.push([rel, staged, destOf(file)]);
      }
    }

    if (pending.length) {
      // From the repo root, like the write path: `oxfmt` is a root
      // devDependency and `yarn oxfmt` does not resolve from the package.
      run("yarn", ["oxfmt", `packages/@alepha/ui/${SCRATCH_DIR_REL}`], {
        cwd: repoRoot,
        stdio: "ignore",
      });
    }

    for (const [rel, staged, dest] of pending) {
      let current;
      try {
        current = readFileSync(dest, "utf8");
      } catch {
        report.drift.push(`${rel} (not in the tree)`);
        continue;
      }
      if (readFileSync(staged, "utf8") !== current) report.drift.push(rel);
    }

    return report;
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
};

/**
 * Fetch a registry item. Returns `null` on 404 so that our own components
 * living in `src/components/ui/` (e.g. `segmented`) — which the upstream
 * registry does not know about — are skipped instead of aborting the run.
 */
const fetchJson = async (url: string): Promise<RegistryItem | null> => {
  const r = await fetch(url);
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`${url} → ${r.status}`);
  return r.json() as Promise<RegistryItem>;
};

// Fetch every primitive currently in src/components/ui/ from the public
// shadcn Base UI Nova registry. Our own blocks live one level up in
// src/components/<name>/ and are not refetched.
//
// The directory listing IS the list: a primitive nothing imports is deleted
// rather than kept warm, and comes back with one `sync` the day it is needed.
// Three of them have no importer in this repo and are kept for downstream:
// `button-group` (club), `resizable` (lindocara), `spinner` (ticketing).
// Anything else with no importer anywhere is dead weight - eleven were removed
// on 2026-08-26 after scanning club, ticketing, lindocara and papers by import
// path and by symbol.
const stock = readdirSync(join(srcDir, "components/ui"))
  .filter((f) => f.endsWith(".tsx"))
  .map((f) => f.replace(/\.tsx$/, ""));

log(`Fetching ${stock.length} shadcn primitives…`);
const results: Array<[string, RegistryItem | null]> = await Promise.all(
  stock.map(async (name): Promise<[string, RegistryItem | null]> => [
    name,
    await fetchJson(`${SHADCN_BASE}/${name}.json`),
  ]),
);
const skipped = results.filter(([, item]) => !item).map(([name]) => name);
if (skipped.length) {
  log(`Not in registry, left untouched: ${skipped.join(", ")}`);
}
if (check) {
  const report = checkFiles(
    results
      .map(([, item]) => item)
      .filter((item): item is RegistryItem => item != null),
  );

  log(`${report.protected.length} files kept local (see KEEP_LOCAL).`);
  if (report.drift.length) {
    log(`Upstream has moved on for ${report.drift.length} files:`);
    for (const rel of report.drift.sort((a, b) => a.localeCompare(b))) {
      console.log(`    ${rel}`);
    }
    log("Run `yarn w @alepha/ui sync` to take them, then review the diff.");
  } else {
    log("No upstream drift.");
  }

  if (report.broken.length) {
    for (const message of report.broken) {
      console.error(`\x1b[31m✗\x1b[0m ${message}`);
    }
    console.error(
      `\n${report.broken.length} local divergence(s) are no longer protected. ` +
        "The next sync would lose them.",
    );
    process.exit(1);
  }

  log("Every local patch applies and every protected file is in place.");
} else {
  writeFiles(
    planWrites(
      results
        .map(([, item]) => item)
        .filter((item): item is RegistryItem => item != null),
    ),
  );

  log("Linting and formatting with oxlint + oxfmt…");
  run("yarn", ["oxlint", "--fix", "packages/@alepha/ui/src"], {
    cwd: repoRoot,
  });
  run("yarn", ["oxfmt", "packages/@alepha/ui/src"], { cwd: repoRoot });

  log("Sync complete. Review `git diff` before committing.");
}
