#!/usr/bin/env node
/**
 * Guards the conventions that had quietly drifted, so they stop drifting.
 *
 * A trimmed copy of the Alepha monorepo's `scripts/check-conventions.ts`,
 * keeping the rules that read this repository: subpath exports, no module-level
 * code in the Lore API, CI concurrency and setup, `describe` + `it`, no
 * `toThrowError`, one Vitest project per workspace, the project-atom writer,
 * no `$transactional` in Lore, and job names. The rules about the framework,
 * the docs site and `@alepha/ui` stay where those live; the vendored copies
 * under `.vendor/` are never read here.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";

import { JobNameRule } from "./job-name-rule.ts";
import { LorePackageGraph } from "./lore-package-graph.ts";

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
 * Every workspace of this repository, the vendored framework excluded: it is
 * checked where it is developed.
 */
const workspaces: Workspace[] = execFileSync(
  "yarn",
  ["workspaces", "list", "--json"],
  { encoding: "utf8" },
)
  .trim()
  .split("\n")
  .map((line): Workspace => JSON.parse(line))
  .filter((workspace) => !workspace.location.startsWith(".vendor"));

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
 */
const SUBPATH_EXEMPT: Record<string, string | string[]> = {
  // A container, not a module. `.` is the DI kernel itself; `$module` is
  // declared *by* it.
  alepha: ["."],
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
 * API, in `apps/lore` and in every `@lore` package. It is not repo-wide because it cannot yet be - `server/`, `react/`
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
  "apps/lore/src/api",
  // The Lore API as it moves into the `@lore/*` packages (#E75): each
  // package's own `src/api`, the same tree under a new root.
  ...readdirSync("packages/@lore")
    .map((pkg) => `packages/@lore/${pkg}/src/api`)
    .filter((tree) => existsSync(tree)),
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
].filter(
  (file) =>
    existsSync(file) && !file.includes("/e2e/") && !file.startsWith(".vendor/"),
);

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
].filter((file) => existsSync(file) && !file.startsWith(".vendor/"));

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
 * repository root, whose `test.root` was the repository, so a workspace's
 * `test` script ran every spec in the repository, not its own. Every one of
 * those commands reported success, so nobody had a reason to look.
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
  .filter((file) => !file.startsWith(".vendor/"))
  .filter((file) => !file.split("/").includes("e2e"));

/**
 * The workspace a file belongs to: the longest location that prefixes it.
 * `apps/lore` and the root workspace `.` both prefix a Lore spec, and only the
 * longest is the owner.
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

// The app's web tree and every `@lore` package's (#E75), untracked files
// included so a page moved five minutes ago is already read.
const atomReaders = execFileSync(
  "git",
  [
    "ls-files",
    "-co",
    "--exclude-standard",
    "apps/lore/src/web",
    "packages/@lore",
  ],
  { encoding: "utf8" },
)
  .trim()
  .split("\n")
  .filter(
    (file) =>
      (file.startsWith("apps/") ||
        /^packages\/@lore\/[^/]+\/src\/web\//.test(file)) &&
      existsSync(file) &&
      /\.tsx?$/.test(file) &&
      !file.includes(".spec."),
  );

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
 * Lore holds no `$transactional` (#E69).
 *
 * ## Why a mechanical rule rather than a comment
 *
 * Lore runs on Cloudflare D1, which has no transactions: `$transactional()`
 * runs its handler in place there, and a throw rolls nothing back. Twenty-nine
 * actions carried one anyway, each promising an atomicity production never
 * had, and the specs could not tell, because the SQLite driver they ran on
 * does roll back (#F1348). Every one was replaced by a pattern that holds on
 * D1: `db.version()` with `save()`, a precondition in the write's WHERE, a
 * safe write order, a name claimed first, or a best-effort step after the
 * main write. A new `$transactional` would read as protection and give none.
 *
 * Code only: the text is stripped of comments and strings first, so the
 * notes that explain why the primitive is gone do not trip it. Specs are
 * skipped. There is no exemption list: the one legitimate transaction, an
 * ownership transfer, lives in the framework's `MemberService`.
 */
const transactionalViolations: string[] = [];

// The app and every `@lore` package: Lore's code, wherever it now lives (#E75).
const loreSources = execFileSync(
  "git",
  ["ls-files", "-co", "--exclude-standard", "apps/lore/src", "packages/@lore"],
  { encoding: "utf8" },
)
  .trim()
  .split("\n")
  .filter(
    (file) =>
      existsSync(file) && /\.tsx?$/.test(file) && !file.includes(".spec."),
  );

for (const file of loreSources) {
  const code = stripLiterals(readFileSync(file, "utf8"));
  if (/\$transactional\b/.test(code)) {
    transactionalViolations.push(
      `  ${file}\n    → uses \`$transactional\`, which is a no-op on D1`,
    );
  }
}

if (transactionalViolations.length > 0) {
  console.error(
    `\n${transactionalViolations.length} Lore file(s) using $transactional:\n\n` +
      `${transactionalViolations.join("\n")}\n\n` +
      "Lore runs on D1, which has no transactions: the handler runs in place\n" +
      "and a throw rolls nothing back. Use one of the five patterns instead\n" +
      "(folio #F1348): db.version() with save(), the precondition in the\n" +
      "write's WHERE, a safe write order, the name claimed first, or\n" +
      "BestEffort.run for what follows the main write.\n",
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
 * `system.*` and nothing under `apps/` is, except `packages/@lore/`: Lore
 * itself, split into modules, whose jobs keep their application names. The
 * per-file check is `JobNameRule` (`scripts/job-name-rule.ts`).
 *
 * The name has to be a string literal inside the `$job({ ... })` call, or this
 * rule cannot read it. Specs are exempt: they declare jobs for pretend
 * applications, and the registration check still binds them. Files are read
 * whole rather than through `grep`, which skips a file holding a NUL byte as
 * binary (`apps/lore/src/api/jobs/SigilJobs.ts` has one on purpose).
 */
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

const jobNameRule = new JobNameRule();
for (const file of jobSources) {
  const { names, timeouts } = jobNameRule.check(
    file,
    readFileSync(file, "utf8"),
  );
  jobNameViolations.push(...names);
  jobTimeoutViolations.push(...timeouts);
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

/*
 * The `@lore` packages depend on core only (#E75, folio #F1356).
 *
 * `work`, `knowledge` and `deploy` import `@lore/core` and nothing else of
 * Lore's; `core` imports none of them. The graph, and the four rules that go
 * with it (no deep import, type-only server imports from `./web`, no app, no
 * `@/`), are `scripts/lore-package-graph.ts`, which reads the allowed edges
 * from one table.
 */
const lorePackageExports: Record<string, string[]> = {};
for (const workspace of workspaces) {
  const match = /^packages\/@lore\/([^/]+)$/.exec(workspace.location);
  if (!match) continue;
  const manifest: Manifest = JSON.parse(
    readFileSync(`${workspace.location}/package.json`, "utf8"),
  );
  lorePackageExports[match[1]] = Object.keys(manifest.exports ?? {})
    .filter((subpath) => subpath !== "./package.json")
    .map((subpath) => subpath.slice(2));
}

const lorePackageGraph = new LorePackageGraph(lorePackageExports);
const lorePackageViolations = execFileSync(
  "git",
  ["ls-files", "-co", "--exclude-standard", "packages/@lore"],
  { encoding: "utf8" },
)
  .trim()
  .split("\n")
  .filter((file) => /\.(ts|tsx)$/.test(file) && existsSync(file))
  .flatMap((file) => lorePackageGraph.check(file, readFileSync(file, "utf8")));

if (lorePackageViolations.length > 0) {
  console.error(
    `\n${lorePackageViolations.length} @lore package import(s) off the graph:\n\n` +
      `${lorePackageViolations.join("\n")}\n\n` +
      "work, knowledge and deploy import @lore/core only, and core imports no\n" +
      "other @lore package. A feature spanning two modules goes through a core\n" +
      "registry or a core link. The graph is LorePackageGraph.GRAPH in\n" +
      "scripts/lore-package-graph.ts.\n",
  );
  process.exit(1);
}

console.log("conventions OK");
