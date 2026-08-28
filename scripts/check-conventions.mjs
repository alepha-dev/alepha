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
import { readFileSync } from "node:fs";

const SRC = "packages/alepha/src";

/**
 * A file is exempt from the `Date.now()` rule when the timestamp it produces is
 * not a decision the application makes — file metadata, or a unique-ish suffix.
 * Faking the clock there would buy nothing and cost a provider injection in
 * code that has no container.
 */
const DATE_NOW_EXEMPT = [
  "server/core/services/HttpClient.ts",
  // The provider itself has to read the wall clock somewhere.
  "datetime/providers/DateTimeProvider.ts",
  // `now: () => Date.now()` is already an injectable seam: the default is
  // overridden wherever the clock needs to be controlled.
  "websocket/providers/WebSocketRoom.ts",
  "websocket/providers/NodeWebSocketServerProvider.ts",
  // Unique temp-directory suffix, never compared or asserted on.
  "bucket/providers/LocalFileStorageProvider.ts",
];

/**
 * `BuildServerTask` emits a `throw new Error(...)` **into the generated
 * bundle** as a string. That code runs in the built app, where `AlephaError`
 * is not in scope — it is not this codebase throwing.
 */
const THROW_EXEMPT = ["cli/core/tasks/BuildServerTask.ts"];

const search = (pattern) => {
  try {
    return execFileSync(
      "grep",
      ["-rn", "--include=*.ts", "--include=*.tsx", pattern, SRC],
      { encoding: "utf8" },
    )
      .split("\n")
      .filter(Boolean);
  } catch {
    // grep exits 1 when it matches nothing, which is the outcome we want.
    return [];
  }
};

/** Drop tests, and JSDoc lines — an example is documentation, not logic. */
const isRelevant = (line) => {
  const [file] = line.split(":");
  if (/__tests__|\.spec\.|fixtures/.test(file)) return false;
  const body = line.slice(line.indexOf(":", line.indexOf(":") + 1) + 1);
  return !/^\s*\*/.test(body);
};

const violations = [];

for (const line of search("throw new Error(").filter(isRelevant)) {
  const file = line.split(":")[0].slice(SRC.length + 1);
  if (THROW_EXEMPT.some((e) => file.endsWith(e))) continue;
  violations.push(`  ${line.trim()}\n    → use AlephaError`);
}

for (const line of search("Date.now()").filter(isRelevant)) {
  const file = line.split(":")[0].slice(SRC.length + 1);
  if (DATE_NOW_EXEMPT.some((e) => file.endsWith(e))) continue;
  violations.push(
    `  ${line.trim()}\n    → inject DateTimeProvider, use nowMillis()`,
  );
}

if (violations.length > 0) {
  console.error(
    `\n${violations.length} convention violation(s):\n\n${violations.join("\n")}\n\n` +
      "If one of these is genuinely exempt, add it to the allowlist in\n" +
      "scripts/check-conventions.mjs — with the reason.\n",
  );
  process.exit(1);
}

// An allowlist entry that no longer matches anything is a stale exemption:
// it will silently cover a future violation in the same file.
const stale = [...DATE_NOW_EXEMPT, ...THROW_EXEMPT].filter((f) => {
  try {
    const src = readFileSync(`${SRC}/${f}`, "utf8");
    return !src.includes("Date.now()") && !src.includes("throw new Error(");
  } catch {
    return true; // file gone
  }
});

if (stale.length > 0) {
  console.error(
    `\nStale exemption(s) in scripts/check-conventions.mjs — nothing to exempt:\n` +
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
const workspaces = execFileSync("yarn", ["workspaces", "list", "--json"], {
  encoding: "utf8",
})
  .trim()
  .split("\n")
  .map((line) => JSON.parse(line));

const versionViolations = [];

for (const workspace of workspaces) {
  const manifest = JSON.parse(
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
 * `@alepha/sigil` is why this exists. It reached the eve of its first release
 * with 14 subpaths and one module: `./key` was `src/shared/sigilKey.ts`,
 * `./paths` was `src/shared/sigilPaths.ts`, ten more of the same. None of them
 * saved a consumer anything, because every importer already loaded the module
 * from the same bundle, and `./react` had no importer at all. Nothing in the
 * repo could see it: inside the monorepo the dev `exports` point at `src` and
 * always resolve, so 13 of 14 subpaths pointed at files the tarball did not
 * contain while every test stayed green.
 *
 * The exemptions below are the two shapes that legitimately have no `@module`.
 */
const SUBPATH_EXEMPT = {
  // A component library, not a module: many subpaths on purpose, one per
  // component, so an app pulls only what it renders. Wildcards - there is no
  // file to hold a block.
  "@alepha/ui": "*",
  // A container, not a module. `.` is the DI kernel itself; `$module` is
  // declared *by* it.
  alepha: ["."],
  "@alepha/payments-mollie": ["."],
  // `./vat` is `services/VatCalculator.ts` - a class handed a public path,
  // the same mistake sigil spent 13 subpaths on. Exempt rather than fixed
  // because commerce is private and its whole surface is already queued for
  // restructure: 15 subpaths, a build that emits one entry, and no
  // `publishConfig` at all, so 14 of them would resolve to nothing in a
  // tarball. Delete this line when that lands - it must not outlive it.
  "@alepha/commerce": ["./vat"],
};

const subpathViolations = [];

for (const workspace of workspaces) {
  if (workspace.location === ".") continue;

  const manifest = JSON.parse(
    readFileSync(`${workspace.location}/package.json`, "utf8"),
  );
  const exempt = SUBPATH_EXEMPT[manifest.name];
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
 * `cli/`, `api/users/` and `system/`. It is not repo-wide because it cannot
 * yet be - `server/`, `react/` and `core/` still carry about a hundred
 * module-level declarations between them, and an allowlist that large is
 * the "list of things nobody dares touch" this file warns about above. Add
 * a tree here once it is clean, never an exemption inside one.
 *
 * Only service-shaped directories count. A `schemas/`, `entities/` or
 * `atoms/` file is module-level constants by definition - that IS the file.
 */
const NO_MODULE_CODE_TREES = ["cli", "api/users", "system"];
const SERVICE_DIRS = ["services", "providers", "commands", "tasks"];

/**
 * Blank out comments and string bodies, keeping every newline, so a line
 * scan sees only real code.
 *
 * Load-bearing, not defensive: `BuildCloudflareTask` and `db.ts` both emit
 * *generated code* as template literals, and that generated code declares
 * module-level functions at column 0 on purpose. A raw grep reads them as
 * violations of a rule they are not even subject to.
 */
const stripLiterals = (src) => {
  let out = "";
  let i = 0;
  const keep = (ch) => (ch === "\n" ? "\n" : " ");

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
  [
    ...NO_MODULE_CODE_TREES.map((tree) => `${SRC}/${tree}`),
    "-type",
    "f",
    "-name",
    "*.ts",
  ],
  { encoding: "utf8" },
)
  .split("\n")
  .filter(Boolean)
  .filter((file) => SERVICE_DIRS.some((dir) => file.includes(`/${dir}/`)))
  .filter((file) => !/__tests__|\.spec\.|fixtures/.test(file));

const moduleCodeViolations = [];

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

console.log("conventions OK");
