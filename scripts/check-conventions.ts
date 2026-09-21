#!/usr/bin/env node
/**
 * Guards the conventions that had quietly drifted, so they stop drifting.
 *
 *   1. Errors extend `AlephaError` — a bare `Error` loses the framework's
 *      `name` and the handling that keys off it.
 *   2. Time comes from `DateTimeProvider` — `Date.now()` in business logic is
 *      what makes a behaviour untestable with `travel()` / `pause()`.
 *   3. A workspace declares a `version` if and only if it is published.
 *
 * The first two have legitimate exceptions, and a guard that cannot express
 * them gets disabled the first time it is wrong. They are listed below, each
 * with the reason it is exempt — an unexplained entry is how an allowlist
 * rots into a list of things nobody dares touch.
 *
 * Rules 1 and 2 read framework sources only. Tests may do whatever is
 * convenient; that is the point of a test. Rule 3 spans every workspace,
 * because that is the scope of the thing it protects.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { parseAst } from "rolldown/parseAst";

/**
 * One row of `yarn workspaces list --json`.
 */
interface Workspace {
  name: string;
  location: string;
}

/**
 * The parts of a workspace's `package.json` this file reads. Not exhaustive -
 * only what is actually inspected below.
 */
interface Manifest {
  name?: string;
  private?: boolean;
  version?: string;
  exports?: Record<string, ExportsEntry>;
}

/**
 * One value of a package's `exports` map: a bare path, or a conditions object
 * whose `types`/`import` branch is what a subpath actually resolves to.
 */
type ExportsEntry = string | { types?: string; import?: string };

/**
 * The trees rules 1 and 2 read.
 *
 * `packages/alepha/src` was the whole list, which left every app free to do
 * what the framework forbids - and `apps/docs` had picked up a `Date.now()`
 * and a bare `throw new Error`. The docs app is the one nobody thinks of as
 * code: it renders the very guides that state these rules.
 *
 * Its `scripts/` is in scope too. `gen-docs`, `gen-tree`, `gen-llms` and
 * `check-docs` are `$command`s in the container like any other, so `AlephaError`
 * is in scope there and the exemption a build script might claim does not
 * apply.
 *
 * Deliberately not every app: `apps/lore` and the examples are a much larger
 * sweep and their own decision, not a side effect of this one.
 */
const SRC = "packages/alepha/src";

const SRC_ROOTS = ["packages/alepha/src", "apps/docs/src", "apps/docs/scripts"];

/**
 * A file is exempt from the `Date.now()` rule when the timestamp it produces is
 * not a decision the application makes — file metadata, or a unique-ish suffix.
 * Faking the clock there would buy nothing and cost a provider injection in
 * code that has no container.
 */
const DATE_NOW_EXEMPT = [
  "packages/alepha/src/server/core/services/HttpClient.ts",
  // The provider itself has to read the wall clock somewhere.
  "packages/alepha/src/datetime/providers/DateTimeProvider.ts",
  // `now: () => Date.now()` is already an injectable seam: the default is
  // overridden wherever the clock needs to be controlled.
  "packages/alepha/src/websocket/providers/WebSocketRoom.ts",
  "packages/alepha/src/websocket/providers/NodeWebSocketServerProvider.ts",
  // Unique temp-directory suffix, never compared or asserted on.
  "packages/alepha/src/bucket/providers/LocalFileStorageProvider.ts",
];

/**
 * `BuildServerTask` emits a `throw new Error(...)` **into the generated
 * bundle** as a string. That code runs in the built app, where `AlephaError`
 * is not in scope — it is not this codebase throwing.
 */
const THROW_EXEMPT = ["packages/alepha/src/cli/core/tasks/BuildServerTask.ts"];

const search = (pattern: string): string[] => {
  try {
    return execFileSync(
      "grep",
      ["-rn", "--include=*.ts", "--include=*.tsx", pattern, ...SRC_ROOTS],
      { encoding: "utf8" },
    )
      .split("\n")
      .filter(Boolean);
  } catch {
    // grep exits 1 when it matches nothing, which is the outcome we want.
    return [];
  }
};

/**
 * Drop tests, and comment lines — an example is documentation, not logic.
 *
 * Both comment styles, and the `//` half is not cosmetic: the honest way to
 * write one of these fixes is to say in a comment which construct was avoided
 * and why, and that sentence necessarily contains the banned string. Without
 * this, explaining the rule trips the rule.
 */
const isRelevant = (line: string): boolean => {
  const [file] = line.split(":");
  if (/__tests__|\.spec\.|fixtures/.test(file)) return false;
  const body = line.slice(line.indexOf(":", line.indexOf(":") + 1) + 1);
  return !/^\s*(\*|\/\/)/.test(body);
};

const violations: string[] = [];

for (const line of search("throw new Error(").filter(isRelevant)) {
  const file = line.split(":")[0];
  if (THROW_EXEMPT.some((e) => file.endsWith(e))) continue;
  violations.push(`  ${line.trim()}\n    → use AlephaError`);
}

for (const line of search("Date.now()").filter(isRelevant)) {
  const file = line.split(":")[0];
  if (DATE_NOW_EXEMPT.some((e) => file.endsWith(e))) continue;
  violations.push(
    `  ${line.trim()}\n    → inject DateTimeProvider, use nowMillis()`,
  );
}

if (violations.length > 0) {
  console.error(
    `\n${violations.length} convention violation(s):\n\n${violations.join("\n")}\n\n` +
      "If one of these is genuinely exempt, add it to the allowlist in\n" +
      "scripts/check-conventions.ts — with the reason.\n",
  );
  process.exit(1);
}

// An allowlist entry that no longer matches anything is a stale exemption:
// it will silently cover a future violation in the same file.
const stale = [...DATE_NOW_EXEMPT, ...THROW_EXEMPT].filter((f) => {
  try {
    const src = readFileSync(f, "utf8");
    return !src.includes("Date.now()") && !src.includes("throw new Error(");
  } catch {
    return true; // file gone
  }
});

if (stale.length > 0) {
  console.error(
    `\nStale exemption(s) in scripts/check-conventions.ts — nothing to exempt:\n` +
      stale.map((f) => `  ${f}`).join("\n") +
      "\n\nRemove them.\n",
  );
  process.exit(1);
}

/**
 * A workspace declares a `version` if and only if it is published.
 *
 * A private workspace ships as a GitHub release asset (`bay`) or a Cloudflare
 * deploy (`lore`), never to the registry, so a number in its manifest is
 * decoration that nothing bumps. `@alepha/commerce`, `payments-mollie` and
 * `sigil` drifted to 0.1.0, 0.20.6 and 0.20.1 while `alepha` reached 0.26.0.
 *
 * The release job's bump step encodes the invariant directly, filtering with
 * `--no-private`, so a violation stays invisible until someone dispatches a
 * release: a private workspace that grows a version is skipped forever, and a
 * published one that loses it aborts the whole bump. That is release 0.27.0,
 * which failed on the root workspace. Checking it here moves the failure into
 * `yarn v`, where it costs nothing.
 */
const workspaces: Workspace[] = execFileSync(
  "yarn",
  ["workspaces", "list", "--json"],
  { encoding: "utf8" },
)
  .trim()
  .split("\n")
  .map((line): Workspace => JSON.parse(line));

const versionViolations: string[] = [];

for (const workspace of workspaces) {
  const manifest: Manifest = JSON.parse(
    readFileSync(`${workspace.location}/package.json`, "utf8"),
  );
  const location = `${workspace.location}/package.json`;

  if (manifest.private === true && manifest.version !== undefined) {
    versionViolations.push(
      `  ${location}\n` +
        `    → private, so it must not declare a version (found ${manifest.version})`,
    );
  }

  if (manifest.private !== true && manifest.version === undefined) {
    versionViolations.push(
      `  ${location}\n    → published, so it must declare a version`,
    );
  }
}

if (versionViolations.length > 0) {
  console.error(
    `\n${versionViolations.length} workspace version violation(s):\n\n` +
      `${versionViolations.join("\n")}\n\n` +
      "A workspace declares a `version` if and only if it is published. The\n" +
      "release job bumps with `--no-private` and relies on it.\n",
  );
  process.exit(1);
}

/**
 * A subpath is a module.
 *
 * Every entry in a package's `exports` names a documented module: the file it
 * resolves to carries an `@module` JSDoc block, which is what gives it a page
 * on the docs site and a line in llms.txt. An export without one is a file that
 * was handed a public path, and `package.json` is the one place in this repo
 * where that decision is permanent - a published subpath is a compatibility
 * promise, and there is no taking it back.
 *
 * `@alepha/lore` is why this exists. It reached the eve of its first release
 * with 14 subpaths and one module: `./key` was `src/shared/sigilKey.ts`,
 * `./paths` was `src/shared/sigilPaths.ts`, ten more of the same. None of them
 * saved a consumer anything, because every importer already loaded the module
 * from the same bundle, and `./react` had no importer at all. Nothing in the
 * repo could see it: inside the monorepo the dev `exports` point at `src` and
 * always resolve, so 13 of 14 subpaths pointed at files the tarball did not
 * contain while every test stayed green.
 *
 * The exemptions below are the shapes that legitimately have no `@module`.
 *
 * `@alepha/ui` was one, with a blanket `"*"`: it exported one wildcard subpath
 * per component and had no file to hold a block. It is seventeen modules now,
 * each an `index.ts` with its own `@module`, and the rules that keep that map
 * honest are further down.
 */
const SUBPATH_EXEMPT: Record<string, string | string[]> = {
  // A container, not a module. `.` is the DI kernel itself; `$module` is
  // declared *by* it.
  alepha: ["."],
  // `./vat` is `services/VatCalculator.ts` - a class handed a public path,
  // the same mistake sigil spent 13 subpaths on. Exempt rather than fixed
  // because commerce is private and its whole surface is already queued for
  // restructure: 15 subpaths, a build that emits one entry, and no
  // `publishConfig` at all, so 14 of them would resolve to nothing in a
  // tarball. Delete this line when that lands - it must not outlive it.
  "@alepha/commerce": ["./vat"],
};

const subpathViolations: string[] = [];

for (const workspace of workspaces) {
  if (workspace.location === ".") continue;

  const manifest: Manifest = JSON.parse(
    readFileSync(`${workspace.location}/package.json`, "utf8"),
  );
  const exempt = manifest.name ? SUBPATH_EXEMPT[manifest.name] : undefined;
  if (exempt === "*") continue;

  for (const [subpath, value] of Object.entries(manifest.exports ?? {})) {
    if (subpath === "./package.json" || subpath === "./tsconfig.base") continue;
    if (exempt?.includes(subpath)) continue;

    const target =
      typeof value === "string" ? value : (value.types ?? value.import);
    // Only source entries are modules. A `.css` or a wildcard is an asset.
    if (!target?.startsWith("./src/") || !/\.tsx?$/.test(target)) continue;
    if (target.includes("*")) continue;

    const file = `${workspace.location}/${target.slice(2)}`;
    let body;
    try {
      body = readFileSync(file, "utf8");
    } catch {
      subpathViolations.push(
        `  ${manifest.name} ${subpath}\n    → resolves to ${target}, which does not exist`,
      );
      continue;
    }

    if (!/@module\s/.test(body)) {
      subpathViolations.push(
        `  ${manifest.name} ${subpath}\n    → ${target} has no \`@module\` block`,
      );
    }
  }
}

if (subpathViolations.length > 0) {
  console.error(
    `\n${subpathViolations.length} subpath violation(s):\n\n` +
      `${subpathViolations.join("\n")}\n\n` +
      "Every export subpath is a module and carries an `@module` JSDoc block.\n" +
      "If a symbol does not deserve a module, export it from one that exists\n" +
      "rather than giving it a path - a published subpath cannot be withdrawn.\n",
  );
  process.exit(1);
}

/**
 * Never write code outside classes.
 *
 * A helper or a constant sitting next to a service class is not
 * substitutable: a test cannot replace it through the container, and a
 * subclass cannot override it. Everything a service uses belongs on the
 * service, which is the whole reason the container exists.
 *
 * ⚠️ SCOPE. This reads only the trees that have actually been cleaned:
 * `cli/`, `api/users/` and `system/` in the framework, plus the whole Lore
 * API. It is not repo-wide because it cannot yet be - `server/`, `react/`
 * and `core/` still carry about a hundred module-level declarations between
 * them, and an allowlist that large is the "list of things nobody dares
 * touch" this file warns about above. Add a tree here once it is clean,
 * never an exemption inside one.
 *
 * Only service-shaped directories count. A `schemas/`, `entities/` or
 * `atoms/` file is module-level constants by definition - that IS the file.
 * `controllers/` and `jobs/` ARE service-shaped: both hold DI classes whose
 * members a test substitutes, so a helper beside one is as unreachable as a
 * helper beside a provider.
 */
const NO_MODULE_CODE_TREES = [
  `${SRC}/cli`,
  `${SRC}/api/users`,
  `${SRC}/system`,
  "apps/lore/src/api",
];
const SERVICE_DIRS = [
  "services",
  "providers",
  "commands",
  "tasks",
  "controllers",
  "jobs",
];

/**
 * Blank out comments and string bodies, keeping every newline, so a line
 * scan sees only real code.
 *
 * Load-bearing, not defensive: `BuildCloudflareTask` and `db.ts` both emit
 * *generated code* as template literals, and that generated code declares
 * module-level functions at column 0 on purpose. A raw grep reads them as
 * violations of a rule they are not even subject to.
 */
const stripLiterals = (src: string): string => {
  let out = "";
  let i = 0;
  const keep = (ch: string): string => (ch === "\n" ? "\n" : " ");

  while (i < src.length) {
    const ch = src[i];
    const next = src[i + 1];

    if (ch === "/" && next === "/") {
      while (i < src.length && src[i] !== "\n") out += keep(src[i++]);
      continue;
    }
    if (ch === "/" && next === "*") {
      const end = src.indexOf("*/", i + 2);
      const stop = end === -1 ? src.length : end + 2;
      while (i < stop) out += keep(src[i++]);
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      const quote = ch;
      out += ch;
      i++;
      while (i < src.length) {
        if (src[i] === "\\") {
          out += "  ".slice(0, 2 - (src[i + 1] === "\n" ? 1 : 0));
          if (src[i + 1] === "\n") out += "\n";
          i += 2;
          continue;
        }
        if (src[i] === quote) break;
        out += keep(src[i++]);
      }
      out += src[i] ?? "";
      i++;
      continue;
    }
    out += ch;
    i++;
  }
  return out;
};

const serviceFiles = execFileSync(
  "find",
  [...NO_MODULE_CODE_TREES, "-type", "f", "-name", "*.ts"],
  { encoding: "utf8" },
)
  .split("\n")
  .filter(Boolean)
  .filter((file) => SERVICE_DIRS.some((dir) => file.includes(`/${dir}/`)))
  .filter((file) => !/__tests__|\.spec\.|fixtures/.test(file));

const moduleCodeViolations: string[] = [];

for (const file of serviceFiles) {
  const lines = stripLiterals(readFileSync(file, "utf8")).split("\n");
  lines.forEach((line, index) => {
    if (/^(export )?(const|let|var|function|async function) /.test(line)) {
      moduleCodeViolations.push(
        `  ${file}:${index + 1}\n    → ${line.trim().slice(0, 72)}\n` +
          "      move it onto the class (protected member) or into its own service",
      );
    }
  });
}

if (moduleCodeViolations.length > 0) {
  console.error(
    `\n${moduleCodeViolations.length} module-level code violation(s):\n\n` +
      `${moduleCodeViolations.join("\n")}\n\n` +
      "Service files hold classes only - a helper outside one cannot be\n" +
      "substituted through the container, which is what makes it untestable.\n",
  );
  process.exit(1);
}

/**
 * Every dev port sits in the 33xx band, and the port table knows about it.
 *
 * The bands are disjoint on purpose: e2e lives in 4300-4999 so a `yarn dev`
 * left running in another terminal cannot be adopted by Playwright.
 *
 * The table in the root CLAUDE.md is the human-readable half, and it had
 * already drifted: `examples/totp` took 3307 and the table never heard about
 * it. A table nobody checks documents the ports that happened to be assigned
 * when someone last read it, which is worse than none - it is the thing a
 * person consults before picking a "free" number.
 */
const PORT_TABLE_ROW = /^\|\s*`3300-3399`\s*\|(.*)\|\s*$/m;

const declaredPorts = execFileSync(
  "git",
  ["ls-files", "apps/**/alepha.config.ts", "packages/**/vite.config.ts"],
  { encoding: "utf8" },
)
  .trim()
  .split("\n")
  .filter(Boolean)
  .flatMap((file) => {
    const src = readFileSync(file, "utf8");
    const dev = /\bdev:\s*\{[^}]*\bport:\s*(\d+)/.exec(src);
    const server = /\bserver:\s*\{[\s\S]*?\bport:\s*(\d+)/.exec(src);
    const port = dev?.[1] ?? server?.[1];
    return port ? [{ file, port: Number(port) }] : [];
  });

const tableRow = PORT_TABLE_ROW.exec(readFileSync("CLAUDE.md", "utf8"))?.[1];
const portViolations: string[] = [];

if (!tableRow) {
  portViolations.push(
    "  CLAUDE.md\n    → the `3300-3399` row of the port table is missing",
  );
}

for (const { file, port } of declaredPorts) {
  if (port < 3300 || port > 3399) {
    portViolations.push(
      `  ${file}\n    → dev port ${port} is outside the 3300-3399 band`,
    );
    continue;
  }
  if (tableRow && !tableRow.includes(String(port))) {
    portViolations.push(
      `  ${file}\n    → dev port ${port} is not in CLAUDE.md's port table`,
    );
  }
}

if (portViolations.length > 0) {
  console.error(
    `\n${portViolations.length} dev port violation(s):\n\n` +
      `${portViolations.join("\n")}\n\n` +
      "Dev servers live in 3300-3399, and the port table in the root\n" +
      "CLAUDE.md lists every one of them. Both halves matter: the band keeps\n" +
      "e2e out, and the table is what a person reads before\n" +
      "picking the next number.\n",
  );
  process.exit(1);
}

/*
 * The CI workflow's `workflow_run` runs must not share a concurrency group
 * with a push to main.
 *
 * `github.ref` for a `workflow_run` event is the default branch, so the naive
 * `group: ci-${{ github.ref }}` put a Release follow-up in the same group as a
 * push to main. With `cancel-in-progress`, the follow-up cancelled the push run
 * mid-test - and that push run is the only one carrying
 * `deploy-lore-production`. The symptom is a run marked `cancelled`,
 * indistinguishable from the ordinary "a newer push superseded this one", and a
 * deploy that simply never happened.
 *
 * Checked here because the alternative is not checkable: proving it needs a
 * Release to complete while a main push is mid-flight, on the real repository.
 * A rule that can only be verified in production is a rule that gets reverted
 * by the next person who finds the expression ugly.
 *
 * The assertion is deliberately about the SHAPE, not the exact string: the
 * group must branch on `github.event_name`, so any expression that keeps the
 * two events apart passes and the one that does not, fails.
 */
const concurrencyViolations: string[] = [];

// Every workflow, not one named file. This was `.github/workflows/ci.yml`
// until that file was split into `verify.yml` and `deploy-latest.yml` on
// 2026-09-09, at which point the check did not report a violation - it
// crashed on ENOENT, taking the whole `check:conventions` step with it. A
// rule that names one file stops being a rule the moment the file is renamed.
const workflowDir = ".github/workflows";
for (const file of readdirSync(workflowDir).sort()) {
  if (!file.endsWith(".yml") && !file.endsWith(".yaml")) continue;
  const path = `${workflowDir}/${file}`;
  const source = readFileSync(path, "utf8");

  const cancels = /^\s*cancel-in-progress:\s*true\s*$/m.test(source);
  const triggersOnWorkflowRun = /^\s{2}workflow_run:\s*$/m.test(source);
  if (!cancels || !triggersOnWorkflowRun) continue;

  const groupLine = /^concurrency:\n(?:\s*#.*\n)*\s*group:\s*(.+)$/m.exec(
    source,
  );
  if (!groupLine) {
    concurrencyViolations.push(
      `  ${path}\n    → cancels in progress and triggers on \`workflow_run\`,` +
        " but declares no top-level `concurrency.group`",
    );
    continue;
  }

  // The rule is about `github.ref` specifically, because that is the
  // expression whose value is a surprise: on a `workflow_run` it resolves to
  // the DEFAULT BRANCH. A group that never mentions it cannot have the bug -
  // `deploy-latest.yml` keys on `workflow_run.head_branch` and is correct
  // without mentioning `github.event_name` at all, which the older
  // "must contain github.event_name" form would have called a violation.
  const group = groupLine[1];
  if (group.includes("github.ref") && !group.includes("github.event_name")) {
    concurrencyViolations.push(
      `  ${path}\n    → group ${group.trim()}\n` +
        "      keys on `github.ref` without distinguishing `workflow_run`",
    );
  }
}

if (concurrencyViolations.length > 0) {
  console.error(
    `\n${concurrencyViolations.length} CI concurrency violation(s):\n\n` +
      `${concurrencyViolations.join("\n")}\n\n` +
      "A `workflow_run` run resolves `github.ref` to the default branch, so a\n" +
      "group keyed on `github.ref` alone puts it in the same group as a push to\n" +
      "main. With `cancel-in-progress`, the Release follow-up then cancels the\n" +
      "push run that carries the Lore deploy, and nothing goes red.\n",
  );
  process.exit(1);
}

/*
 * Corepack is installed AFTER the Node the jobs actually run on.
 *
 * `corepack enable` used to be the setup action's first step, executed against
 * whatever Node the runner image booted with. The repository pins Node 26,
 * which ships no corepack at all, so `yarn` only resolved afterwards because
 * the image's older Node had left a shim on PATH - an accident of PATH order
 * that nothing declared and nothing tested. The day the image drops its
 * bundled corepack, every job fails at `yarn` with no clue why.
 *
 * The same reasoning bans `cache: "yarn"` on `setup-node`: its caching runs the
 * package manager to locate the cache directory, which puts a `yarn` call back
 * in front of the corepack install and quietly restores the dependency. The
 * cache is done with `actions/cache` afterwards instead.
 *
 * Checked here because it cannot be checked anywhere else: the failure needs a
 * runner image that has moved on, and by then it is every job at once.
 */
const SETUP_ACTION = ".github/actions/setup/action.yml";
// Comment lines dropped first. The file explains this very rule in prose, so a
// search over the raw text matches the explanation and reports the thing it is
// describing as present - which is exactly what the first version of this
// check did.
const setupSource = readFileSync(SETUP_ACTION, "utf8")
  .split("\n")
  .filter((line) => !/^\s*#/.test(line))
  .join("\n");
const setupViolations: string[] = [];

const nodeAt = setupSource.indexOf("actions/setup-node@");
const corepackAt = setupSource.search(/corepack\s+enable/);

if (nodeAt === -1) {
  setupViolations.push(
    `  ${SETUP_ACTION}\n    → no \`actions/setup-node\` step`,
  );
} else if (corepackAt !== -1 && corepackAt < nodeAt) {
  setupViolations.push(
    `  ${SETUP_ACTION}\n    → \`corepack enable\` runs before \`actions/setup-node\`,` +
      "\n      so it enables the runner image's corepack, not the pinned Node's",
  );
}

if (/^\s*cache:\s*["']?yarn["']?\s*$/m.test(setupSource)) {
  setupViolations.push(
    `  ${SETUP_ACTION}\n    → \`cache: yarn\` on setup-node runs yarn before corepack is installed`,
  );
}

if (corepackAt !== -1 && !/corepack@\d+\.\d+\.\d+/.test(setupSource)) {
  setupViolations.push(
    `  ${SETUP_ACTION}\n    → corepack is not pinned to an exact version`,
  );
}

if (setupViolations.length > 0) {
  console.error(
    `\n${setupViolations.length} CI setup violation(s):\n\n` +
      `${setupViolations.join("\n")}\n\n` +
      "Node 26 bundles no corepack. It has to be installed explicitly, pinned,\n" +
      "and AFTER `setup-node` — otherwise `yarn` resolves through a shim the\n" +
      "runner image happened to leave on PATH, and the day that stops being\n" +
      "true every job fails at once.\n",
  );
  process.exit(1);
}

/*
 * Every directory under `docs/` is published by the docs site.
 *
 * `gen-tree` walked one hardcoded root, `docs/framework`. `docs/bay` and
 * `docs/lore` were written, maintained and validated - `check-docs` scans all
 * of `docs/`, so they were never unchecked - and then published nowhere. Two
 * introduction pages nobody could read, with nothing anywhere to say they were
 * missing. That is the failure this guards: a doc tree can only ever be
 * SILENTLY unpublished, never loudly.
 *
 * `superpowers` is excluded for the same reason `check-docs` excludes it: an
 * archive of past plans, true when written and not a claim about today.
 */
const DOCS_EXCLUDED = new Set(["superpowers"]);
const GEN_TREE = "apps/docs/scripts/gen-tree.ts";
const genTreeSource = readFileSync(GEN_TREE, "utf8");
const docRootViolations: string[] = [];

const docDirs = execFileSync("git", ["ls-files", "docs/"], { encoding: "utf8" })
  .trim()
  .split("\n")
  .filter(Boolean)
  .map((file) => file.split("/")[1])
  .filter((dir, i, all) => dir && all.indexOf(dir) === i)
  .filter((dir) => !DOCS_EXCLUDED.has(dir));

for (const dir of docDirs) {
  // Matched against the `dir:` field of a DOC_ROOTS entry, so a directory
  // merely NAMED in a comment does not count as published.
  if (!genTreeSource.includes(`dir: "docs/${dir}"`)) {
    docRootViolations.push(
      `  docs/${dir}\n    → not in ${GEN_TREE}'s DOC_ROOTS, so nothing publishes it`,
    );
  }
}

if (docRootViolations.length > 0) {
  console.error(
    `\n${docRootViolations.length} unpublished doc tree(s):\n\n` +
      `${docRootViolations.join("\n")}\n\n` +
      "`check-docs` validates everything under `docs/`, so an orphaned tree is\n" +
      "checked and correct and simply never rendered. Add it to DOC_ROOTS with\n" +
      "an order-prefixed category, or delete the directory.\n",
  );
  process.exit(1);
}

/*
 * CHANGELOG.md is English, and stays English.
 *
 * The 0.25.0 section was written from French commit subjects and translated by
 * hand afterwards. Those subjects are in git history forever, so any
 * regeneration of that range brings them back - verified, not assumed:
 * `alepha gen changelog --from=0.24.0 --to=0.25.0` still emits
 * "AuthRouter — les quatre écrans d'auth" today.
 *
 * The release workflow itself cannot cause that. It prepends the new section
 * and `cat CHANGELOG.md >>` the rest, so old sections are preserved
 * byte-for-byte, and the generator writes `latestTag..HEAD` to stdout. What is
 * unguarded is the OTHER direction, which the finding did not mention: a French
 * commit subject written today flows into the next release's section
 * automatically, with nobody reading it in between. This catches both.
 *
 * The word list is deliberately narrow. `le`, `la`, `des`, `est`, `que`, `sur`,
 * `plus`, `tout`, `pour` and `dont` are all left out because each has an
 * English reading that could plausibly appear in a changelog, and a guard with
 * a false positive is a guard someone deletes. Calibrated against the real
 * file: zero hits across its 1788 lines.
 */
const FRENCH_WORDS = [
  "les",
  "une",
  "dans",
  "avec",
  "sont",
  "qui",
  "sans",
  "vers",
  "lors",
  "afin",
  "leur",
  "leurs",
  "cette",
  "ainsi",
  "mais",
  "puis",
  "nous",
  "vous",
  "elle",
  "elles",
  "peut",
  "doit",
  "faire",
  "fait",
];

const changelogViolations: string[] = [];
const changelogLines = readFileSync("CHANGELOG.md", "utf8").split("\n");

for (const [index, line] of changelogLines.entries()) {
  const found = FRENCH_WORDS.find((word) =>
    new RegExp(`\\b${word}\\b`, "i").test(line),
  );
  if (found) {
    changelogViolations.push(
      `  CHANGELOG.md:${index + 1}\n    → French ("${found}"): ${line.trim().slice(0, 100)}`,
    );
  }
}

if (changelogViolations.length > 0) {
  console.error(
    `\n${changelogViolations.length} French changelog line(s):\n\n` +
      `${changelogViolations.slice(0, 20).join("\n")}\n\n` +
      "The changelog is the release notes, so it is the one document written\n" +
      "from commit subjects without anyone reading it in between. Rewrite the\n" +
      "entry in English - and the commit subject too, if it has not shipped.\n",
  );
  process.exit(1);
}

/**
 * A spec's cases live inside a `describe`.
 *
 * The house style is `describe` + `it`, and the thing that actually costs
 * something when it drifts is the `describe`: without it the reporter prints
 * a flat list of sentences with no subject, and `vitest run -t` has no handle
 * to select a subject by. Five specs had drifted to a bare `test(...)` at the
 * top of the file - `Alepha-with`, `Router`, `ReactServerProvider`, `$channel`
 * and `$websocket-new`.
 *
 * Indentation is the test for "top level", not a parse. Every file here is
 * formatted by oxfmt, so a case at column zero is a case outside every block,
 * and the check stays a grep rather than a second TypeScript dependency.
 *
 * `it` is refused at column zero for the same reason as `test`: renaming the
 * call without adding the `describe` fixes the half that was never the
 * problem. Inside a block, both spellings are left alone - `test` and `it` are
 * the same function in vitest, and rewriting 1200 call sites would be a diff
 * nobody can review for a difference nobody can observe.
 *
 * `e2e/` is excluded because Playwright's API *is* `test`, with no `it` to
 * move to, and its specs are files of independent scenarios rather than a
 * suite about one subject.
 */
const FLAT_CASE = /^(test|it)(\.\w+)*\(/;

// Untracked files too (`-o`), so a spec written five minutes ago is checked
// where it is cheap to fix rather than on the CI run after the commit.
const specFiles = [
  ...new Set(
    execFileSync(
      "git",
      ["ls-files", "-c", "-o", "--exclude-standard", "*.spec.ts", "*.spec.tsx"],
      { encoding: "utf8" },
    )
      .split("\n")
      .filter(Boolean),
  ),
].filter((file) => existsSync(file) && !file.includes("/e2e/"));

const flatSpecViolations: string[] = [];

for (const file of specFiles) {
  const lines = readFileSync(file, "utf8").split("\n");
  for (const [index, line] of lines.entries()) {
    if (FLAT_CASE.test(line)) {
      flatSpecViolations.push(
        `  ${file}:${index + 1}\n    → wrap the file's cases in a describe() named after the subject`,
      );
    }
  }
}

if (flatSpecViolations.length > 0) {
  console.error(
    `\n${flatSpecViolations.length} flat spec case(s):\n\n` +
      `${flatSpecViolations.join("\n")}\n\n` +
      "A case at the top level of a spec has no subject in the reporter and no\n" +
      "handle for `vitest run -t`. Wrap the file in a describe() and use it().\n",
  );
  process.exit(1);
}

/**
 * No `toThrowError`, the alias Vitest 5 deprecates in favour of `toThrow`.
 *
 * The two are one matcher, so this is about the strike-through in every editor
 * and about `CLAUDE.md` recommending the dead spelling - not behaviour. Why a
 * grep here when `.oxlintrc.json` turns on `vitest/no-alias-methods`: that rule
 * only recognises an `expect` it can trace to an import, and almost every spec
 * in this repo takes `expect` from the test fixture instead
 * (`it("…", async ({ expect }) => …)`). On the sweep that removed the alias
 * its fixer rewrote 174 of 570 call sites and saw none of the other 396, so
 * the rule alone would let the alias back in one fixture spec at a time.
 *
 * Spec files and the shared helpers under `__tests__/`, which are not specs
 * (`$repository-tests.ts` and its siblings) but hold assertions all the same.
 */
const THROW_ERROR_ALIAS = /\.toThrowError\(/;

const assertionFiles = [
  ...new Set([
    ...specFiles,
    ...execFileSync(
      "git",
      ["ls-files", "-c", "-o", "--exclude-standard", "*/__tests__/*.ts"],
      { encoding: "utf8" },
    )
      .split("\n")
      .filter(Boolean),
  ]),
].filter((file) => existsSync(file));

const aliasViolations: string[] = [];

for (const file of assertionFiles) {
  const lines = readFileSync(file, "utf8").split("\n");
  for (const [index, line] of lines.entries()) {
    if (THROW_ERROR_ALIAS.test(line)) {
      aliasViolations.push(`  ${file}:${index + 1}\n    → .toThrow(`);
    }
  }
}

if (aliasViolations.length > 0) {
  console.error(
    `\n${aliasViolations.length} toThrowError call(s):\n\n` +
      `${aliasViolations.join("\n")}\n\n` +
      "`toThrowError` is a deprecated alias of `toThrow`, the same matcher.\n" +
      "Rename it; `vitest/no-alias-methods` cannot see an `expect` that comes\n" +
      "from the test fixture, so this check is what keeps it out.\n",
  );
  process.exit(1);
}

/*
 * 6. A workspace holding spec files owns a Vitest config, and the root config
 *    knows about it.
 *
 * Until Vitest 5, Vitest walked up from its cwd until it found a config.
 * Before per-workspace configs existed that walk always ended at the
 * repository root, whose `test.root` was the repository, so
 * `yarn w @alepha/protobuf test` ran all 892 specs in the monorepo and
 * `yarn w alepha test` ran 328 files that are not in `packages/alepha`. Every
 * one of those commands reported success, so nobody had a reason to look.
 * Vitest 5 no longer walks up, which only makes the miss quieter: a workspace
 * without its own config now runs its specs on bare defaults, with no service
 * env, no Paris timezone, no tsconfig aliases and no jsdom project.
 *
 * The failure this guards is the same shape in the other direction: a
 * workspace whose config exists but is missing from the root's import list
 * contributes nothing to `yarn test`, and a suite that silently shrinks looks
 * exactly like a suite that passes.
 *
 * `apps/e2e-cli` is the one exemption. It packs a tarball and scaffolds a real
 * project, and the root run has always excluded it; it owns a config and runs
 * from `yarn e2e-cli`.
 */
const VITEST_ROOT_EXEMPT = {
  "apps/e2e-cli":
    "packs a tarball; runs from `yarn e2e-cli`, never `yarn test`",
};

const unitSpecFiles = execFileSync(
  "git",
  ["ls-files", "*.spec.ts", "*.spec.tsx"],
  { encoding: "utf8" },
)
  .trim()
  .split("\n")
  .filter(Boolean)
  .filter((file) => !file.split("/").includes("e2e"));

/**
 * The workspace a file belongs to: the longest location that prefixes it.
 * `apps/examples/shop` and the root workspace `.` both prefix a shop spec, and
 * only the longest is the owner.
 */
const specOwnerOf = (file: string): Workspace | undefined =>
  workspaces
    .filter((w) => w.location === "." || file.startsWith(`${w.location}/`))
    .sort((a, b) => b.location.length - a.location.length)[0];

const specOwners = new Map<string, { owner: Workspace; browser: boolean }>();

for (const file of unitSpecFiles) {
  const owner = specOwnerOf(file);
  if (!owner) {
    continue;
  }
  const entry = specOwners.get(owner.location) ?? { owner, browser: false };
  entry.browser ||= /\.browser\.spec\.(ts|tsx)$/.test(file);
  specOwners.set(owner.location, entry);
}

const rootVitestConfig = readFileSync("vitest.config.ts", "utf8");
const vitestViolations: string[] = [];

for (const [location, { owner, browser }] of specOwners) {
  if (location in VITEST_ROOT_EXEMPT) {
    continue;
  }

  // The root workspace declares its project inline in the root config, since
  // its config file IS the root config.
  const config =
    location === "." ? "vitest.config.ts" : `${location}/vitest.config.ts`;

  if (!existsSync(config)) {
    vitestViolations.push(
      `  ${location}\n    → has spec files but no vitest.config.ts, so` +
        " `yarn w " +
        owner.name +
        " test` runs the whole monorepo",
    );
    continue;
  }

  const source = readFileSync(config, "utf8");

  if (location !== "." && !rootVitestConfig.includes(`./${config}`)) {
    vitestViolations.push(
      `  ${location}\n    → its vitest.config.ts is not imported by the root` +
        " vitest.config.ts, so `yarn test` never runs its specs",
    );
  }

  const declaresJsdom = /\bjsdom:\s*true\b/.test(source);

  if (browser && !declaresJsdom) {
    vitestViolations.push(
      `  ${config}\n    → has *.browser.spec files but does not pass` +
        " `jsdom: true`, so they run in the node environment or not at all",
    );
  }

  if (!browser && declaresJsdom) {
    vitestViolations.push(
      `  ${config}\n    → passes \`jsdom: true\` but has no *.browser.spec` +
        " files; drop the flag",
    );
  }
}

if (vitestViolations.length > 0) {
  console.error(
    `\n${vitestViolations.length} vitest project violation(s):\n\n` +
      `${vitestViolations.join("\n")}\n\n` +
      "Every workspace with spec files owns a vitest.config.ts built from\n" +
      "`workspaceProjects`, and the root vitest.config.ts imports it. That is\n" +
      "what makes `yarn w <workspace> test` mean what it says and keeps\n" +
      "`yarn test` the union of every workspace.\n",
  );
  process.exit(1);
}

/**
 * `currentProjectAtom` is written through `setCurrentProject`, never through
 * the setter `useStore` hands back.
 *
 * ## Why a mechanical rule rather than a comment
 *
 * There already was a comment, and a helper, and eight call sites using it.
 * The ninth reached for `const [project, setProject] = useStore(...)` and
 * wrote the update response straight in - which drops `permissions`, because
 * `updateProjectById` answers `projectResourceSchema` and that schema
 * deliberately does not carry an effective permission set (it is also the
 * shape of `getMyProjects` and the Kanban payload). `canInProject` answers
 * FALSE for an absent set, on purpose, so the entire sidebar disappeared
 * until the next full page load. Feedback #P2141, and it was the second time:
 * the capability toggle did the same thing before it.
 *
 * A reader cannot see any of that at the call site. The write looks like
 * every other `useStore` setter in the tree, and the field it silently
 * discards is not mentioned within a hundred lines of it. That is exactly the
 * kind of rule that belongs here rather than in review.
 *
 * Reading the atom is untouched: `const [project] = useStore(...)` is what
 * most of these files do and is correct.
 */
const PROJECT_ATOM_WRITER =
  "apps/lore/src/web/app/services/currentProjectWrite.ts";
const projectAtomViolations: string[] = [];

const atomReaders = execFileSync("git", ["ls-files", "apps/lore/src/web"], {
  encoding: "utf8",
})
  .trim()
  .split("\n")
  .filter((file) => /\.tsx?$/.test(file) && !file.includes(".spec."));

for (const file of atomReaders) {
  if (file === PROJECT_ATOM_WRITER) continue;
  const source = readFileSync(file, "utf8");
  // The SETTER being destructured, not the read: a two-element pattern.
  if (
    /const\s*\[[^\]]*,[^\]]*\]\s*=\s*useStore\(\s*currentProjectAtom\s*\)/.test(
      source,
    )
  ) {
    projectAtomViolations.push(
      `  ${file}\n    → takes the setter from \`useStore(currentProjectAtom)\`;` +
        " write through `setCurrentProject` so `permissions` and `rank` survive",
    );
  }
}

if (projectAtomViolations.length > 0) {
  console.error(
    `\n${projectAtomViolations.length} currentProjectAtom write(s) bypassing the helper:\n\n` +
      `${projectAtomViolations.join("\n")}\n\n` +
      "`updateProjectById` and friends answer a narrow project resource with\n" +
      "no `permissions` on it, and `canInProject` reads an absent set as false.\n" +
      "A direct write therefore hides every rank-gated control on the page -\n" +
      "the whole sidebar - until the next navigation. `setCurrentProject`\n" +
      "carries the two loader-only fields forward.\n",
  );
  process.exit(1);
}

/**
 * Every `$job` names itself `[system.]<domain>.<action>`, and `system.` means
 * shipped from `packages/`.
 *
 * ## Why a mechanical rule rather than a comment
 *
 * There was a comment: the `name` JSDoc recommended `api:module:jobName`, and
 * the name was optional with a `ClassName.propertyKey` default. Twenty-four
 * jobs ended up in four naming styles, and the name is a job's identity in
 * `job_executions`, so every later fix is a rename that loses history. The
 * registration checks the shape at boot; what it cannot see is where a job
 * comes from, which is the half this rule checks: a framework job must never
 * collide with an application's, so everything under `packages/` is
 * `system.*` and nothing under `apps/` is.
 *
 * The name has to be a string literal inside the `$job({ ... })` call, or this
 * rule cannot read it. Specs are exempt: they declare jobs for pretend
 * applications, and the registration check still binds them. Files are read
 * whole rather than through `grep`, which skips a file holding a NUL byte as
 * binary (`apps/lore/src/api/jobs/SigilJobs.ts` has one on purpose).
 */
const JOB_NAME = /^(system\.)?[a-z0-9]+(-[a-z0-9]+)*\.[a-z0-9]+(-[a-z0-9]+)*$/;
const jobNameViolations: string[] = [];
const jobTimeoutViolations: string[] = [];

const jobSources = execFileSync("git", ["ls-files", "packages", "apps"], {
  encoding: "utf8",
})
  .trim()
  .split("\n")
  .filter(
    (file) =>
      existsSync(file) &&
      /\.tsx?$/.test(file) &&
      !file.includes(".spec.") &&
      !file.includes("/__tests__/") &&
      !file.includes("/e2e/"),
  );

for (const file of jobSources) {
  const source = readFileSync(file, "utf8");
  // A declaration is an assignment: `work = $job({`. Prose, JSDoc examples
  // and strings that merely mention `$job({ cron })` never assign it.
  for (const call of source.matchAll(/=\s*\$job\(\{/g)) {
    const open = (call.index ?? 0) + call[0].length;
    let depth = 1;
    let end = open;
    while (depth > 0 && end < source.length) {
      const char = source[end];
      if (char === "{") depth++;
      else if (char === "}") depth--;
      end++;
    }
    // Only the call's own properties: blank every nested object first.
    let top = source.slice(open, end - 1);
    let previous = "";
    while (previous !== top) {
      previous = top;
      top = top.replace(/\{[^{}]*\}/g, "");
    }
    const line = source.slice(0, call.index).split("\n").length;
    const literal = /(?:^|[\n,])\s*name\s*:\s*(["'])([^"'\n]*)\1/.exec(top);
    if (!literal) {
      jobNameViolations.push(
        `  ${file}:${line}\n    → names its job with no string literal; write \`name: "<domain>.<action>"\``,
      );
      continue;
    }
    const name = literal[2];
    const fromPackages = file.startsWith("packages/");
    if (!JOB_NAME.test(name)) {
      jobNameViolations.push(
        `  ${file}:${line}\n    → '${name}' is not <domain>.<action> in lowercase kebab-case`,
      );
    } else if (fromPackages && !name.startsWith("system.")) {
      jobNameViolations.push(
        `  ${file}:${line}\n    → '${name}' ships from packages/ and must be system.<domain>.<action>`,
      );
    } else if (!fromPackages && name.startsWith("system.")) {
      jobNameViolations.push(
        `  ${file}:${line}\n    → '${name}' is an application job; system. is reserved for packages/`,
      );
    }
    // A top-level key only: `top` has every nested object blanked, so a
    // `timeout` passed to a call inside the handler is not the job's.
    if (
      fromPackages &&
      name.startsWith("system.") &&
      !/(?:^|[\n,])\s*timeout\s*:/.test(top)
    ) {
      jobTimeoutViolations.push(
        `  ${file}:${line}\n    → '${name}' declares no timeout`,
      );
    }
  }
}

if (jobNameViolations.length > 0) {
  console.error(
    `\n${jobNameViolations.length} job name(s) off the convention:\n\n` +
      `${jobNameViolations.join("\n")}\n\n` +
      "A job is named [system.]<domain>.<action> in lowercase kebab-case, with\n" +
      "system. for everything shipped from packages/ and never in an app. The\n" +
      "name is the job's identity in job_executions: renaming it later loses\n" +
      "its history, so get it right at declaration.\n",
  );
  process.exit(1);
}

/*
 * Every job the framework ships declares a `timeout` (#Q2452).
 *
 * A `system.*` job lands in every app that mounts its module. With no
 * `timeout`, two numbers nobody chose do the work: the cron lock falls back to
 * five minutes and crash recovery to the jobs `runTimeout` (30 minutes), and
 * on Cloudflare's direct mode, where a job gets about 30s of wall clock,
 * `BuildCloudflareTask` warned about each of them on every build of every app.
 * Sixteen did. Read by the naming rule's loop above, so the two cannot
 * disagree about what a job declaration is. Only `system.*`: an application's
 * own jobs are its author's call, and the Cloudflare build already tells them.
 */
if (jobTimeoutViolations.length > 0) {
  console.error(
    `\n${jobTimeoutViolations.length} system job(s) without a timeout:\n\n` +
      `${jobTimeoutViolations.join("\n")}\n\n` +
      "A job shipped from packages/ lands in every app that mounts its module,\n" +
      "and with no timeout its cron lock and crash recovery fall back to\n" +
      "defaults nobody chose. Declare one, at most 30 seconds unless the job\n" +
      "needs a queue: that is Cloudflare's direct-mode budget.\n",
  );
  process.exit(1);
}

/**
 * `@alepha/ui`'s module map keeps its shape.
 *
 * The package is seventeen modules, one subpath each, and every rule below is a
 * way that shape used to break, or would break silently:
 *
 * 1. **Symmetry.** Every `src/**\/index.ts` is exported, every export points at
 *    one, and the dev and publish maps list the same keys. A module created and
 *    never exported ships as dead files; an export that outlives its directory
 *    resolves to nothing; and a key only the dev map carries resolves in the
 *    monorepo and not from the tarball, which is exactly how the `.ts` subpaths
 *    went missing from the published package for weeks.
 * 2. **Placement.** Every file under `src` other than `styles.css` lives inside
 *    an exported module's directory. tsdown's entry glob builds whatever is
 *    there, so a stray `src/components/foo/` would ship, be exported by
 *    nothing, and pass rule 1 because it has no `index.ts`.
 * 3. **No self-import.** No `@alepha/ui` specifier under the package's `src`,
 *    and no relative import of a module's `index.ts`. Inside the package every
 *    import is relative and names a concrete file: tsdown `unbundle` keeps that
 *    one file at a time, and an import through a barrel is how a module ends up
 *    importing itself in a cycle.
 * 4. **Layering**, over non-spec sources. `core` imports no other module, so
 *    `import { Button } from "@alepha/ui"` never loads the form stack; `chart`,
 *    `command`, `calendar`, `otp`, `resizable` and `i18n/fr` import only
 *    `core`, so an opt-in wrapper cannot quietly grow a heavy dependency;
 *    `organizations` imports only `core`, `form`, `table`, and `settings`; and
 *    the module graph has no cycle. Specs are outside it
 *    (`AccountRouter.spec.ts` imports the admin router, legitimately), and
 *    there is deliberately no allow-list of edges: an edge that is not a cycle
 *    is a design decision, not a violation.
 *
 * The imports are parsed with `rolldown/parseAst`, never grepped: a multi-line
 * `import type` defeats a line regex, and a comment that names a specifier is
 * not an import. Type-only imports are edges too - they are edges of the
 * declaration graph the package publishes.
 */
const UI_PACKAGE = "packages/@alepha/ui";
const UI_SRC = `${UI_PACKAGE}/src/`;
const UI_LEAF_MODULES = [
  "core",
  "chart",
  "command",
  "calendar",
  "otp",
  "resizable",
  "i18n/fr",
];
const UI_ALLOWED_IMPORTS: Record<string, ReadonlySet<string>> = {
  organizations: new Set(["core", "form", "table", "settings"]),
};
const uiViolations: string[] = [];

const uiManifest = JSON.parse(
  readFileSync(`${UI_PACKAGE}/package.json`, "utf8"),
) as Manifest & {
  publishConfig?: {
    exports?: Record<string, ExportsEntry | { default?: string }>;
  };
};

// Tracked AND untracked: a module a session has just created is exactly the
// file that must not slip past because it was not yet added.
const uiFiles = execFileSync(
  "git",
  ["ls-files", "--cached", "--others", "--exclude-standard", UI_SRC],
  { encoding: "utf8" },
)
  .trim()
  .split("\n")
  .filter((file) => file && existsSync(file));

const exportTarget = (entry: unknown): string | undefined => {
  if (typeof entry === "string") return entry;
  const conditions = entry as {
    types?: string;
    import?: string;
    default?: string;
  };
  return conditions?.types ?? conditions?.import ?? conditions?.default;
};

// Rule 1: symmetry.
const uiModules = new Map<string, string>(); // src-relative dir -> subpath
const devKeys = Object.keys(uiManifest.exports ?? {});
const publishKeys = Object.keys(uiManifest.publishConfig?.exports ?? {});
for (const key of devKeys) {
  if (key === "./package.json" || key === "./styles.css") continue;
  const target = exportTarget(uiManifest.exports?.[key]);
  const match = target?.match(/^\.\/src\/(.+)\/index\.ts$/);
  if (!match) {
    uiViolations.push(
      `  ${key}\n    → points at ${target}, not at a module's \`src/<module>/index.ts\``,
    );
    continue;
  }
  if (!existsSync(`${UI_SRC}${match[1]}/index.ts`)) {
    uiViolations.push(`  ${key}\n    → ${target} does not exist`);
  }
  uiModules.set(match[1], key);
  const published = uiManifest.publishConfig?.exports?.[key] as
    | { types?: string; default?: string }
    | undefined;
  if (
    published &&
    (published.types !== `./dist/${match[1]}/index.d.ts` ||
      published.default !== `./dist/${match[1]}/index.js`)
  ) {
    uiViolations.push(
      `  ${key}\n    → publishes ${JSON.stringify(published)}, not ./dist/${match[1]}/index.{d.ts,js}`,
    );
  }
}
for (const key of new Set([...devKeys, ...publishKeys])) {
  if (!devKeys.includes(key) || !publishKeys.includes(key)) {
    uiViolations.push(
      `  ${key}\n    → in the ${devKeys.includes(key) ? "dev" : "publish"} exports map only; both maps list the same keys`,
    );
  }
}
for (const file of uiFiles) {
  const match = file.slice(UI_SRC.length).match(/^(.+)\/index\.ts$/);
  if (match && !uiModules.has(match[1])) {
    uiViolations.push(
      `  ${file}\n    → a module index that no subpath exports; add \`./${match[1]}\` to both exports maps, or move the file`,
    );
  }
}

// Rule 2: placement.
const uiModuleOf = (file: string): string | undefined => {
  const rel = file.slice(UI_SRC.length);
  let best: string | undefined;
  for (const dir of uiModules.keys()) {
    if (rel.startsWith(`${dir}/`) && (!best || dir.length > best.length))
      best = dir;
  }
  return best;
};
for (const file of uiFiles) {
  if (file === `${UI_SRC}styles.css`) continue;
  if (!uiModuleOf(file)) {
    uiViolations.push(
      `  ${file}\n    → outside every module directory; tsdown would build it and no subpath would export it`,
    );
  }
}

// Rules 3 and 4 read the parsed import graph.
const uiIsSpec = (file: string): boolean =>
  /\.spec\.tsx?$/.test(file) || file.includes("/__tests__/");
const uiSpecifiers = (file: string): string[] => {
  const ast = parseAst(readFileSync(file, "utf8"), {
    lang: file.endsWith(".tsx") ? "tsx" : "ts",
  });
  const found: string[] = [];
  const visit = (node: unknown): void => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const child of node) visit(child);
      return;
    }
    const n = node as {
      type?: string;
      source?: { type?: string; value?: unknown };
    };
    if (
      (n.type === "ImportDeclaration" ||
        n.type === "ExportNamedDeclaration" ||
        n.type === "ExportAllDeclaration" ||
        n.type === "ImportExpression") &&
      typeof n.source?.value === "string"
    ) {
      found.push(n.source.value);
    }
    for (const value of Object.values(node)) {
      if (value && typeof value === "object") visit(value);
    }
  };
  visit(ast.body);
  return found;
};

const uiEdges = new Map<string, Map<string, string>>(); // from -> to -> example
for (const file of uiFiles) {
  if (!/\.tsx?$/.test(file)) continue;
  const from = uiModuleOf(file);
  for (const specifier of uiSpecifiers(file)) {
    if (specifier === "@alepha/ui" || specifier.startsWith("@alepha/ui/")) {
      uiViolations.push(
        `  ${file}\n    → imports "${specifier}"; inside the package, import the concrete file by a relative path`,
      );
      continue;
    }
    if (!specifier.startsWith(".")) continue;
    const target = join(dirname(file), specifier);
    const to = uiModuleOf(target);
    if (to && target === `${UI_SRC}${to}/index.ts`) {
      uiViolations.push(
        `  ${file}\n    → imports the \`${to}\` barrel ("${specifier}"); name the concrete file instead`,
      );
    }
    if (uiIsSpec(file) || !from || !to || from === to) continue;
    if (!uiEdges.has(from)) uiEdges.set(from, new Map());
    if (!uiEdges.get(from)?.has(to)) uiEdges.get(from)?.set(to, file);
  }
}

// Rule 4: layering.
for (const leaf of UI_LEAF_MODULES) {
  for (const [to, example] of uiEdges.get(leaf) ?? []) {
    if (leaf !== "core" && to === "core") continue;
    uiViolations.push(
      `  ${example}\n    → \`${leaf}\` imports \`${to}\`; ${leaf === "core" ? "core imports no other module" : `${leaf} imports only core`}`,
    );
  }
}
for (const [from, allowed] of Object.entries(UI_ALLOWED_IMPORTS)) {
  for (const [to, example] of uiEdges.get(from) ?? []) {
    if (allowed.has(to)) continue;
    uiViolations.push(
      `  ${example}\n    → \`${from}\` imports \`${to}\`; ${from} imports only ${[...allowed].join(", ")}`,
    );
  }
}
const uiVisiting: string[] = [];
const uiDone = new Set<string>();
const uiCycles = new Set<string>();
const uiWalk = (mod: string): void => {
  if (uiDone.has(mod)) return;
  const at = uiVisiting.indexOf(mod);
  if (at !== -1) {
    // One report per cycle, whichever module the walk entered it from.
    const loop = uiVisiting.slice(at);
    const first = loop.indexOf([...loop].sort()[0] as string);
    const cycle = [...loop.slice(first), ...loop.slice(0, first)];
    const label = [...cycle, cycle[0]].join(" → ");
    if (!uiCycles.has(label)) {
      uiCycles.add(label);
      uiViolations.push(`  module cycle: ${label}`);
    }
    return;
  }
  uiVisiting.push(mod);
  for (const to of uiEdges.get(mod)?.keys() ?? []) uiWalk(to);
  uiVisiting.pop();
  uiDone.add(mod);
};
for (const mod of uiModules.keys()) uiWalk(mod);

if (uiViolations.length > 0) {
  console.error(
    `\n${uiViolations.length} @alepha/ui module-map violation(s):\n\n` +
      `${uiViolations.join("\n")}\n\n` +
      "`@alepha/ui` is one subpath per module, each a `src/<module>/index.ts`\n" +
      "listed in both exports maps. Inside the package, imports are relative and\n" +
      "name a concrete file. `core` imports no other module, the opt-in wrappers\n" +
      "and `i18n/fr` import only `core`, `organizations` imports only `core`, `form`, `table`, and `settings`, and the module graph has no cycle.\n",
  );
  process.exit(1);
}

/**
 * `@alepha/ui` keeps the React conventions CLAUDE.md states for components.
 *
 * #E51 converted the package: every component an arrow taking named props,
 * one component per file, Context only under a written exemption. Nothing kept
 * it that way, so the next primitive written from an upstream example would
 * have brought `function Button({ className, ...props })` straight back. These
 * five rules are the part of that a line scan can hold, over `.tsx` files in
 * `packages/@alepha/ui/src`, specs and fixtures excluded as everywhere else in
 * this file. Apps are not covered: their drift is a separate decision.
 *
 * 1. **Arrow components only**: no column-zero PascalCase `function X(`.
 * 2. **Props are not destructured in the parameter list**: no `const X = ({`.
 * 3. **Props are named and exported**: a component that takes props takes
 *    `props: <Name>Props` (a generic and a default value allowed), declared
 *    as an `export interface` or `export type` in the same file.
 * 4. **One component per file**, except the compound primitive families in
 *    `UI_COMPOUND_FILES`, CLAUDE.md's one exemption.
 * 5. **`createContext` only with its exemption**: the comment directly above
 *    the call contains `Context exemption:`, the marker #Q2188 fixed.
 *
 * A component is a column-zero `const X = (` (or `= <T,>(`) or `function X(`
 * whose name is PascalCase, capital then lowercase, so `PAGE_SIZES` is not
 * one. It is read after `stripLiterals`, so a component inside a template or a
 * comment is not one either. `const Combobox = ComboboxPrimitive.Root` is an
 * alias, not a component, and matches neither shape. A `memo(Impl)` wrapper
 * and its `Impl` are ONE component, named after the wrapper: `Impl` takes the
 * wrapper's props type (`TreeViewRow`).
 */
const UI_REACT_SRC = "packages/@alepha/ui/src/";

/**
 * The files allowed more than one component: each holds one compound
 * primitive, a root and the parts that only mean something inside it
 * (`DropdownMenu` and its content, items, separators). CLAUDE.md, "One
 * component per file", names this as its one exemption.
 *
 * A list rather than a pattern, on purpose. A prefix rule ("`DropdownMenu*`
 * may live in `DropdownMenu.tsx`") would equally let `AppShellHeader` back
 * into `AppShell.tsx`, which is the exact file #E51 split. Adding a family
 * here is a deliberate edit, like adding a subpath.
 */
const UI_COMPOUND_FILES = new Set([
  "core/Alert.tsx",
  "core/AlertDialog.tsx",
  "core/Avatar.tsx",
  "core/Breadcrumb.tsx",
  "core/ButtonGroup.tsx",
  "core/Card.tsx",
  "core/Combobox.tsx",
  "core/ContextMenu.tsx",
  "core/Dialog.tsx",
  "core/Drawer.tsx",
  "core/DropdownMenu.tsx",
  "core/Empty.tsx",
  "core/HoverCard.tsx",
  "core/InputGroup.tsx",
  "core/Kbd.tsx",
  "core/Menubar.tsx",
  "core/Pagination.tsx",
  "core/Popover.tsx",
  "core/Progress.tsx",
  "core/Sheet.tsx",
  "core/Sidebar.tsx",
  "core/Table.tsx",
  "core/Tabs.tsx",
  "core/Tooltip.tsx",
  "chart/Chart.tsx",
  "calendar/Calendar.tsx",
  "command/Command.tsx",
  "otp/InputOTP.tsx",
  "resizable/Resizable.tsx",
]);

const reactViolations: string[] = [];

const reactFiles = execFileSync(
  "git",
  ["ls-files", "--cached", "--others", "--exclude-standard", UI_REACT_SRC],
  { encoding: "utf8" },
)
  .split("\n")
  .filter((file) => file.endsWith(".tsx") && existsSync(file))
  .filter((file) => !/__tests__|\.spec\.|fixtures/.test(file));

const COMPONENT_NAME = "[A-Z][a-z][A-Za-z0-9]*";
const FUNCTION_COMPONENT = new RegExp(
  `^(?:export\\s+(?:default\\s+)?)?(?:async\\s+)?function\\s+(${COMPONENT_NAME})\\s*[<(]`,
);
const ARROW_COMPONENT = new RegExp(
  `^(?:export\\s+)?const\\s+(${COMPONENT_NAME})\\s*=\\s*(?:<[^=]*?>\\s*)?\\(`,
);
const MEMO_WRAPPER = new RegExp(
  `^(?:export\\s+)?const\\s+(${COMPONENT_NAME})\\s*=\\s*(?:React\\.)?memo\\(\\s*(${COMPONENT_NAME})\\s*\\)`,
);

/**
 * The text between the parameter list's parentheses, starting at the `(` at
 * `open` in the stripped source. Balanced on `()`, `{}` and `[]`, so a default
 * value (`= {}`) and a function type inside a generic stay inside.
 */
const parameterList = (code: string, open: number): string => {
  let depth = 0;
  for (let i = open; i < code.length; i++) {
    const ch = code[i];
    if (ch === "(" || ch === "{" || ch === "[") depth++;
    if (ch === ")" || ch === "}" || ch === "]") depth--;
    if (depth === 0) return code.slice(open + 1, i);
  }
  return code.slice(open + 1);
};

for (const file of reactFiles) {
  const rel = file.slice(UI_REACT_SRC.length);
  const raw = readFileSync(file, "utf8");
  const code = stripLiterals(raw);
  const lines = code.split("\n");
  const lineStarts: number[] = [];
  lines.reduce((offset, line) => {
    lineStarts.push(offset);
    return offset + line.length + 1;
  }, 0);

  const memoImpl = new Map<string, string>(); // impl -> wrapper
  for (const line of lines) {
    const memo = MEMO_WRAPPER.exec(line);
    if (memo) memoImpl.set(memo[2] as string, memo[1] as string);
  }

  const components: string[] = [];
  lines.forEach((line, index) => {
    const at = `  ${file}:${index + 1}`;
    const fn = FUNCTION_COMPONENT.exec(line);
    const arrow = fn ? null : ARROW_COMPONENT.exec(line);
    if (!fn && !arrow) return;
    const name = (fn ?? arrow)?.[1] as string;
    const component = memoImpl.get(name) ?? name;
    components.push(component);

    if (fn) {
      reactViolations.push(
        `${at}\n    → \`function ${name}\`; write it as \`const ${name} = (props: ${component}Props) => { ... }\``,
      );
    }

    // The `(` that opens the parameter list: the last one on the matched
    // head, which follows the name and any generic.
    const head = (fn ?? arrow)?.[0] as string;
    const open = (lineStarts[index] as number) + head.lastIndexOf("(");
    const params = parameterList(code, open).trim().replace(/,$/, "").trim();
    if (params === "") return;

    if (params.startsWith("{")) {
      reactViolations.push(
        `${at}\n    → \`${name}\` destructures its props in the parameter list; take \`props: ${component}Props\` and destructure in the body`,
      );
      return;
    }

    const typed =
      /^props\??\s*:\s*([A-Za-z_$][\w$]*)\s*(?:<[\s\S]*>)?\s*(?:=[\s\S]*)?$/.exec(
        params,
      );
    const expected = `${component}Props`;
    if (typed?.[1] !== expected) {
      reactViolations.push(
        `${at}\n    → \`${name}\` takes \`${params.replace(/\s+/g, " ").slice(0, 60)}\`; take \`props: ${expected}\``,
      );
      return;
    }
    if (
      !new RegExp(`^export\\s+(?:interface|type)\\s+${expected}\\b`, "m").test(
        code,
      )
    ) {
      reactViolations.push(
        `${at}\n    → \`${expected}\` is not declared in this file as an \`export interface\` or \`export type\``,
      );
    }
  });

  const distinct = [...new Set(components)];
  if (distinct.length > 1 && !UI_COMPOUND_FILES.has(rel)) {
    reactViolations.push(
      `  ${file}\n    → ${distinct.length} components (${distinct.join(", ")}); one per file, an internal one named with this file's prefix`,
    );
  }

  // Rule 5 reads the RAW lines for the comment, and the stripped ones for
  // the call, so a `createContext` named in prose is not a call.
  const rawLines = raw.split("\n");
  lines.forEach((line, index) => {
    if (!/\bcreateContext\s*[<(]/.test(line)) return;
    // A call wrapped onto the line after `const X =` has its comment above
    // the `const`, not above the call.
    let start = index;
    while (start > 0 && /[=(]\s*$/.test(lines[start - 1] ?? "")) start--;
    const comment: string[] = [];
    for (let i = start - 1; i >= 0; i--) {
      const text = (rawLines[i] ?? "").trim();
      if (!/^(\/\/|\/\*|\*)/.test(text)) break;
      comment.push(text);
    }
    if (!comment.some((text) => text.includes("Context exemption:"))) {
      reactViolations.push(
        `  ${file}:${index + 1}\n    → \`createContext\` without a \`Context exemption:\` comment directly above it`,
      );
    }
  });
}

if (reactViolations.length > 0) {
  console.error(
    `\n${reactViolations.length} @alepha/ui React convention violation(s):\n\n` +
      `${reactViolations.join("\n")}\n\n` +
      "In `@alepha/ui`, a component is an arrow function taking\n" +
      "`props: <Name>Props`, exported from its own file, one component per file\n" +
      "(compound primitives excepted, see UI_COMPOUND_FILES), and Context is\n" +
      "used only under a `Context exemption:` comment. See CLAUDE.md, React\n" +
      "components.\n",
  );
  process.exit(1);
}

console.log("conventions OK");
