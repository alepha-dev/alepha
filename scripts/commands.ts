import { connect } from "node:net";

import { $inject, AlephaError, z } from "alepha";
import { ChangedFiles, WorkspaceGraph } from "alepha/cli";
import { $command, type RunOptions, TaskCacheProvider } from "alepha/command";
import { $logger } from "alepha/logger";
import { FileSystemProvider, ShellProvider } from "alepha/system";

/**
 * What `--affected` decided to run.
 */
interface AffectedSelection {
  /**
   * The workspaces the change can reach: the ones that own a changed file,
   * plus everything that depends on them.
   */
  names: string[];

  /**
   * Vitest project filters for the affected workspaces that own a config.
   *
   * Globbed, because a workspace with browser specs owns `<name>` and
   * `<name>:jsdom` and only the glob selects the pair.
   */
  projects: string[];

  /**
   * Whether the change reached every workspace, in which case the selection
   * is not a selection and the pipeline runs whole.
   */
  everything: boolean;
}

/**
 * The repository's own commands: `clean`, `verify` / `v` and `verify:go` /
 * `v:go`. Each takes the slot of a CLI built-in of the same name - the CLI
 * keeps the LAST registration for a name and `defineConfig` registers its
 * services after the built-ins, so each one here is the one `--help` lists
 * and the one that runs.
 *
 * `clean` replaces nothing conceptually, only scope: the CLI's own `clean`
 * removes one app's `dist`, this one removes generated files for the whole
 * repository. `verify` and `verify:go` replace nothing either: the CLI's own
 * `verify` is a single-app pipeline and this monorepo needs the workspace
 * fan-out instead.
 */
export class AlephaCommands {
  protected readonly log = $logger();
  protected readonly graph = $inject(WorkspaceGraph);
  protected readonly changedFiles = $inject(ChangedFiles);
  protected readonly fs = $inject(FileSystemProvider);
  protected readonly shell = $inject(ShellProvider);
  protected readonly cache = $inject(TaskCacheProvider);

  public readonly clean = $command({
    description: "Will remove all generated files.",
    handler: async ({ run }) => {
      await run.rm([
        // The e2e-cli scratch project: a packed tarball plus its own
        // node_modules. `afterAll` removes it, but an interrupted run leaves
        // it behind and it is not small.
        `.e2e-tmp`,
        `coverage`,
        // Two levels: apps live at `apps/<app>` and `apps/examples/<app>`.
        // A single `apps/*/…` silently stopped cleaning everything under
        // `apps/examples/` the moment the examples moved down a level, and
        // a stale `dist` there is exactly what makes an e2e run test the
        // previous build.
        `apps/*/playwright-report`,
        `apps/*/test-results`,
        `apps/*/.playwright`,
        `apps/*/dist`,
        `apps/*/coverage`,
        `apps/*/*/playwright-report`,
        `apps/*/*/test-results`,
        `apps/*/*/.playwright`,
        `apps/*/*/dist`,
        `apps/*/*/coverage`,
        `packages/*/dist`,
        `packages/*/node_modules`,
        `packages/*/coverage`,
        // The scoped packages sit one level deeper.
        `packages/*/*/dist`,
        `packages/*/*/node_modules`,
        `packages/*/*/coverage`,
      ]);
    },
  });

  /**
   * The machine-wide queue key held by `test` and `test:bun`, the two steps
   * that cannot overlap between checkouts.
   *
   * The service env in `vitest.projects.ts` points every checkout at the same
   * `compose.yml` services: one postgres, one redis, one s3mock, one emqx.
   * Postgres already isolates itself per run with a `test_alepha_{epoch}_{rand8}`
   * schema, and the mqtt specs namespace their own topics with a
   * `randomUUID()`, so neither needs this queue. Redis (one fixed key prefix,
   * database 0) and s3mock (one fixed bucket) do not isolate themselves, so
   * two checkouts testing at once can interleave writes or empty a bucket the
   * other is still using. This queue is what keeps that from happening, by
   * making them take turns.
   *
   * **Not `e2e`/`e2e-cli`.** Checked rather than assumed: the service
   * variables live in `vitest.projects.ts`, which Playwright never loads, and
   * no e2e config or `.env` sets one. `examples/playground` and
   * `examples/shop` pin `:memory:`; `lore`, `docs` and `examples/ssr` set no
   * `DATABASE_URL`, so each uses its own checkout's SQLite file; `e2e-cli`
   * says outright it needs no registry and no Docker. Ports are already
   * partitioned by checkout in `playwright.port.ts`. Nothing shared, nothing
   * to queue for.
   *
   * Namespaced because the queue is machine-wide: a bare "test" would put this
   * repo behind any other project on the machine that picked the same word.
   *
   * ⚠️ **This queue is expensive, and the cost is what will tempt the next
   * reader to delete it.** Three worktrees turn three independent runs into
   * one line: a `yarn v` can sit behind "2 runs ahead of you" for twenty
   * minutes to reach a step that takes ninety seconds. It was deleted on
   * 2026-09-04 for exactly that reason and restored the same day.
   *
   * Removing it produced a red `playwright.port.spec.ts > keeps stepping while
   * ports stay busy`, `expected 4581 to be 4571`, and that failure was first
   * blamed on the removal. It was not. `lsof` found 4561 and 4571 held by two
   * orphaned `node dist` e2e servers left behind by another worktree's earlier
   * run. That spec holds its own first two candidates and asserts the third is
   * free, so ANY squatter on the machine breaks it, with or without this
   * queue. Do not read that failure as evidence for keeping the queue: it is a
   * fragility in a spec that binds real sockets, and the fix is to fake the
   * probe there.
   *
   * What the queue actually buys remains only what the paragraphs above say -
   * redis and s3mock, which do not isolate themselves. The honest way out is
   * to give those two a per-run key prefix and bucket name the way postgres
   * and mqtt already do, and then delete this. `ALEPHA_NO_EXCLUSIVE` is the
   * per-run escape hatch meanwhile, when you know yours is the only checkout
   * testing.
   */
  protected static readonly suites = "alepha:test";

  /**
   * The services `vitest.config.ts` points at, exactly the set `compose.yml`
   * provides. When they are down, the suite fails with hundreds of opaque
   * PostgresError/S3NetworkError lines that name no cause, so `verify` probes
   * first and says the one thing worth saying.
   */
  protected static readonly services = [
    { name: "postgres", port: 15432 },
    { name: "redis", port: 16379 },
    { name: "s3mock", port: 19090 },
    { name: "emqx", port: 11883 },
  ];

  public readonly verify = $command({
    aliases: ["v"],
    // The machine-wide slot is on the steps that contend, not on this
    // command: see `suites` above and the `exclusive:` options below.
    //
    // It was on the command first. Correct, and far too wide. `lint`,
    // `typecheck`, `check:*` and `build` share nothing between checkouts, so
    // a second worktree sat through eight minutes of them before finding out
    // its own typecheck was broken.
    description:
      "Run linter, checker and tests (JavaScript/TypeScript only, Go lives in `v:go`).",
    flags: z.object({
      fast: z
        .boolean()
        .describe("Skip build + e2e (faster local sanity check).")
        .optional(),
      // Both default ON, and `--no-affected` / `--no-cache` turn them off:
      // see `CliProvider.resolveFlagDef`, where `--no-x` exists precisely so a
      // defaulted-true flag can be switched off.
      //
      // They were opt-in first, on the reasoning that this command is the gate
      // before a commit and a gate should be exact. Two of the three arguments
      // for that turned out to be wrong. CI does not run this command at all,
      // it runs the underlying scripts as separate steps, so a default here
      // cannot weaken it. And `deploy-lore-production` has
      // `needs: [verify, e2e]`, so a suite missed locally costs a red main and
      // a blocked deploy, not a bad one.
      //
      // What is left is that a speedup you have to remember to type is a
      // speedup nobody gets.
      affected: z
        .boolean()
        .describe(
          "Restrict test, build and e2e to the workspaces a change can reach. `--no-affected` runs everything.",
        )
        .default(true),
      since: z
        .string()
        .describe("The ref `--affected` compares against.")
        .optional(),
      cache: z
        .boolean()
        .describe(
          "Skip steps that already passed against this exact tree, in any checkout. `--no-cache` runs them.",
        )
        .default(true),
    }),
    handler: async ({ run, flags }) => {
      const suites = AlephaCommands.suites;

      // We need to force CI environment
      // -> tsdown has different behavior when run in CI
      process.env.CI = "true";

      // When CI=true, yarn might create an immutable install, which is cool, but we don't need that here
      process.env.YARN_ENABLE_IMMUTABLE_INSTALLS = "false";
      process.env.YARN_ENABLE_HARDENED_MODE = "false";

      // Before the install, so a ref that does not resolve costs two seconds
      // rather than the whole prologue.
      const affected = flags.affected
        ? await this.selectOrRunEverything(flags.since ?? "origin/main")
        : undefined;

      // One fingerprint for the whole run, taken before anything can modify
      // the tree. `yarn copy` and `yarn lint` both write, so a per-step
      // fingerprint would key each step to a tree the previous step produced,
      // and no two runs would ever agree.
      //
      // ⚠️ The constraint that buys: a step which WRITES to the tree must not
      // change the inputs of a later step that is keyed on the same
      // fingerprint. Only `copy` qualifies, and it holds, for a reason worth
      // stating rather than rediscovering. `copy` regenerates the reference
      // docs and the package READMEs and nothing else, no spec reads those,
      // and the root `copy` script ends in `yarn lint`, so its own output is
      // formatted before the pipeline's `lint` step is reached. That is what
      // makes it safe for the `--fast` and full lanes to share a cached
      // `lint`, `test` and `test:bun`, which is worth real time: a full run
      // after a `--fast` one on the same tree skips ~110s of them.
      //
      // If `copy` ever writes something a later step reads, that sharing
      // becomes wrong, and the fix is to put the lane into the key.
      // A fingerprint that cannot be taken disables the cache for this run
      // rather than failing it. `treeFingerprint` still raises, because a
      // fingerprint that quietly fell back to a constant would make every step
      // of every run a hit; catching it HERE is what keeps that property while
      // letting a checkout git cannot describe verify normally.
      let fingerprint: string | undefined;
      if (flags.cache) {
        try {
          fingerprint = await this.treeFingerprint();
        } catch (error) {
          this.log.warn(
            `--cache disabled for this run: ${(error as Error).message}`,
          );
        }
      }

      /**
       * A step whose result can be remembered for an identical tree.
       *
       * Deliberately not used for the install or the cleans below: those exist
       * for their side effects on a directory the fingerprint does not
       * describe, and skipping one leaves a later step to run against a tree
       * that is not there.
       */
      const step = (command: string | string[], extra?: RunOptions) =>
        run(command, {
          ...(fingerprint
            ? {
                cache: this.cache.digest([
                  fingerprint,
                  Array.isArray(command) ? command.join(" + ") : command,
                ]),
              }
            : {}),
          ...extra,
        });

      await run("yarn");
      await run(`yarn clean`);

      if (flags.fast) {
        // No `copy` in this lane, so nothing generated exists to format and
        // `lint` can go first: see the full path below for why the order
        // matters there.
        await step(`yarn lint`);
        await step([
          `yarn typecheck`,
          `yarn check:deps`,
          `yarn check:conventions`,
          `yarn check:docs`,
          `yarn check:i18n`,
          `yarn check:migrations`,
        ]);
        await this.assertServicesUp();

        // Sequential, like the full lane below. These two ran as a parallel
        // group here for as long as this lane existed, and that is one
        // process interleaving with itself: `test:bun` drives the same
        // postgres on 15432 as `test` does, so no queue at any granularity
        // could have saved it. This is the lane used as the gate before a
        // commit, which makes it a good suspect for a flake that never
        // reproduces the same way twice.
        await this.runStep(
          (cmd) => step(cmd, { exclusive: suites }),
          this.testCommand(affected),
          "test",
        );
        await step(`yarn test:bun`, { exclusive: suites });
        return;
      }

      // Deliberately serial, and measured rather than assumed.
      //
      // Grouping these was tried and reverted. On a saturated machine
      // parallelism does not compose: run as one group they finished in
      // 16.8s against 18.4s serial, 1.6s, while `check:deps` alone went
      // from 5.9s to 16.8s and `typecheck` from 10.1s to 16.6s. All that
      // buys is timings that no longer mean anything when a step regresses,
      // and memory pressure on the one tool in this repo with a history of
      // exhausting it. The only pairing below that pays is e2e.
      await step(`yarn copy`);

      // Redundant in this lane, and kept anyway.
      //
      // `gen:docs` writes docs/2-reference, docs/3-packages and every
      // package README straight out of the JSDoc, and its output is not
      // formatted. That used to make `yarn copy` leave ~290 files dirty in
      // the working tree, so ordering it before `lint` here was the whole
      // fix, and anyone who ran `yarn copy` on its own still got the diff.
      // The root `copy` script now ends in `yarn lint` itself, which fixes
      // it everywhere instead of only inside this pipeline.
      //
      // So this is a second pass over an already-clean tree, costing a few
      // seconds. It stays because it is the lint gate the `--fast` lane
      // runs too, and a pipeline whose linting is a side effect of a step
      // named `copy` is one rename away from having none.
      await step(`yarn lint`);

      // After `copy` for the same reason: checking before it would validate
      // a stale copy and miss a doc-breaking comment change.
      await step(`yarn check:docs`);
      await step(`yarn check:deps`);
      await step(`yarn check:conventions`);
      await step(`yarn typecheck`);
      await this.assertServicesUp();

      await step(`yarn check:i18n`);
      await step(`yarn check:migrations`);

      // `test` genuinely does not need `build`, and pairing them still lost:
      // together they took 129.4s against 142.3s serial, because `test` alone
      // stretched from 47.4s to 115.6s under the contention. Thirteen seconds
      // is not worth a test run that takes two and a half times as long to
      // tell you it failed.
      //
      // Still two calls rather than `run([a, b])`, and still for the reason
      // above rather than for the queue that used to be here: `run([a, b])`
      // is `Promise.all`, and these two drive the same postgres, so running
      // them together is one process interleaving with itself.
      await this.runStep(
        (cmd) => step(cmd, { exclusive: suites }),
        this.testCommand(affected),
        "test",
      );
      await step(`yarn test:bun`, { exclusive: suites });
      await this.runStep(step, this.foreachCommand("build", affected), "build");

      // Give the one dev-mode e2e suite a cold Vite cache. Only
      // `apps/examples/ssr/playwright.dev.config.ts` runs `yarn dev`; every
      // other suite serves a built app and never reads `node_modules/.vite`.
      //
      // Deliberately scoped to that single app. The previous
      // `apps/*/node_modules/.vite` sweep deleted the dep-optimizer cache
      // out from under any dev server running during `yarn v`: the server's
      // in-memory metadata still listed the prebundled chunks, so every
      // cold `/node_modules/.vite/deps/*` request 504'd (Outdated Optimize
      // Dep) until restart, surfacing in the browser as "Failed to fetch
      // dynamically imported module" on whatever page was opened next.
      // A dev server on examples/ssr itself can still be hit; nothing else.
      await run.rm([`apps/examples/ssr/node_modules/.vite`]);

      // Both need `build` and neither needs the other. They do not collide:
      // `e2e` serves the playground on its own port (see its
      // playwright.config.ts) and `e2e-cli` exercises a packed tarball with
      // no server at all.
      //
      // `e2e-cli` is not in the graph's reach and has to be decided by hand:
      // it declares no dependency on `alepha`, because what it exercises is a
      // packed tarball rather than an import. So the graph never marks it
      // affected, and skipping it on that basis would mean a change to the
      // CLI never runs the suite that tests the CLI.
      const e2eSuites: string[] = [];
      const browserSuite = this.foreachCommand("e2e", affected);
      if (browserSuite) {
        e2eSuites.push(browserSuite);
      }
      if (this.runsCliSuite(affected)) {
        e2eSuites.push(`yarn e2e-cli`);
      }

      if (e2eSuites.length === 0) {
        this.log.info("--affected: skipping e2e, nothing affected owns it");
      } else {
        await step(e2eSuites);
      }

      // ⚠️ `{ root }`, never `cd X && …`. `shell.run(string)` passes every
      // token through as a LITERAL argument on both runtimes; that is a
      // deliberate contract, pinned by `shellStringContract.spec.ts`, so
      // metacharacters cannot break out of an argument. A `&&` here is not
      // a separator: the whole line spawned the binary `cd` with `&&` and
      // the rest as its arguments, which exits 0 in ten milliseconds having
      // done nothing. This step reported success on every run for as long
      // as it existed and never once generated anything; CI caught the
      // first real failure in it only because the deploy job runs the
      // command properly.
      await run(`yarn alepha gen:llms`, { root: "apps/docs" });
      await run(`yarn clean`);
      await run("yarn");
    },
  });

  /**
   * `verify:go` is not a valid identifier, so unlike `clean` and `verify` it
   * cannot take its name from the property key.
   */
  public readonly verifyGo = $command({
    name: "verify:go",
    aliases: ["v:go"],
    description: "Run the Go suite (apps/bay) on the platform it ships for.",
    handler: async ({ run }) => {
      // A lane of its own rather than a step inside `verify`, because the two
      // toolchains have nothing to say to each other: every Go file in this
      // repo is `apps/bay`, one module, with no edge into the TypeScript
      // graph. Running it on every `yarn v` meant a container start, ~20s,
      // for a change that could not possibly have touched it, which is most
      // changes.
      //
      // Gating it on `git diff` was the other option and was rejected: a
      // heuristic that misfires skips silently, and a silent skip is exactly
      // the failure this repo keeps paying for. A separate command cannot be
      // silently wrong: Go is either what you asked for or it is not.
      //
      // ⚠️ The trade is real: `yarn v` no longer covers Go. The `bay` CI job
      // runs unconditionally on every PR and push, so nothing reaches main
      // unchecked, but a local green now means less than it did. Touch
      // `apps/bay`, run this.
      //
      // Not the native `go test`: that is GREEN while skipping every test of
      // `Systemd.render()`, the sandbox directives, the memory and CPU
      // ceilings, the stop timeout, because those files are `//go:build
      // linux` and do not compile on the machine this is usually run from.
      // `test:linux` reproduces the `bay` CI job in a container: gofmt, vet,
      // build, the whole suite, and a cross-compile for both Linux
      // architectures.
      //
      // No exclusive slot. It used to share one with `verify` on the grounds
      // that both saturate the machine, which cost more than it bought: this
      // lane runs in its own container and touches none of the four services
      // `verify`'s test steps queue for, so all it did was make one command
      // wait out the other for no shared resource at all.
      await run(`yarn w bay test:linux`);
    },
  });

  /**
   * A digest of the exact tree this run is verifying.
   *
   * `HEAD^{tree}` covers everything committed; the working tree is added on
   * top as one hash per dirty or untracked file, because the same file list
   * can hold different content and a run has to be able to tell an edit from
   * an edit and back again.
   *
   * ⚠️ Raises rather than degrades. Every other failure mode here is a slow
   * run; this one is a wrong one. A fingerprint that quietly fell back to a
   * constant would make every step of every run a cache hit, and the pipeline
   * would report success without executing anything.
   */
  protected async treeFingerprint(): Promise<string> {
    const tree = await this.git(["rev-parse", "HEAD^{tree}"]);
    const status = await this.git(["status", "--porcelain", "-uall"]);

    const paths: string[] = [];
    for (const line of status.split("\n").filter(Boolean)) {
      // Porcelain v1 is two status characters, a space, then the path.
      const path = line.slice(3);
      // A rename prints "old -> new" and a deletion has nothing to hash. Both
      // are already described by the status line itself.
      if (!path.includes(" -> ") && (await this.fs.exists(path))) {
        paths.push(path);
      }
    }

    const contents =
      paths.length > 0 ? await this.git(["hash-object", "--", ...paths]) : "";

    return this.cache.digest([tree, status, contents]);
  }

  /**
   * One git invocation, or an error naming it.
   */
  protected async git(argv: string[]): Promise<string> {
    const result = await this.shell.capture(["git", ...argv]);
    if (result.exitCode !== 0) {
      throw new AlephaError(
        `Could not fingerprint the tree: \`git ${argv.join(" ")}\` exited ${result.exitCode}. ${result.stderr}`.trim(),
      );
    }
    return result.stdout.trim();
  }

  /**
   * {@link selectAffected}, degrading to "run everything" rather than failing.
   *
   * The selection is on by default, so it has to be impossible for it to break
   * a run that would otherwise have worked. A checkout with no `origin/main`,
   * a remote under another name, a git that will not answer: each used to be a
   * hard error, which was acceptable while the flag was opt-in and is not now.
   *
   * Degrading UPWARDS is the whole point. `ChangedFiles` still raises rather
   * than reporting an empty change set, because empty means "run nothing" and
   * then reports success; this turns that raise into the full pipeline, which
   * is exactly what the command did before the flag existed.
   */
  protected async selectOrRunEverything(
    ref: string,
  ): Promise<AffectedSelection | undefined> {
    try {
      return await this.selectAffected(ref);
    } catch (error) {
      this.log.warn(
        `--affected disabled for this run, verifying everything: ${(error as Error).message}`,
      );
      return undefined;
    }
  }

  /**
   * The workspaces a change since `ref` can reach, and how to name them to
   * the tools that will run them.
   *
   * ⚠️ This is a heuristic, and the pipeline says so out loud when it uses
   * one. It reasons about package boundaries, so it is right about
   * `dependencies` and blind to everything a package can affect without
   * declaring it: a shared fixture read by path, a service one suite leaves
   * dirty for another, an environment variable. `yarn v` without the flag
   * remains the gate, and CI never passes the flag.
   *
   * The reason it can be trusted at all is that its unknowns resolve
   * generously. A repo-level file selects every workspace, an unplaceable
   * path selects every workspace, a git that cannot answer raises instead
   * of reporting an empty change set, and an EMPTY DIFF selects every
   * workspace rather than none.
   *
   * ⚠️ That last one is not symmetry for its own sake, it is the post-pull
   * trap. `ref` defaults to `origin/main`, and the moment you pull, HEAD IS
   * `origin/main`, so the diff is empty by construction. The old behaviour
   * narrowed that to zero workspaces and skipped test, build and e2e, so
   * `yarn v` straight after a pull exited 0 in seventy seconds having
   * verified nothing at workspace level - the most dangerous shape a gate
   * can take, because it looks like a fast green. "Nothing changed" is not
   * "nothing to check": it means this ref cannot narrow anything, and the
   * generous reading is the whole repo.
   */
  protected async selectAffected(ref: string): Promise<AffectedSelection> {
    const changed = await this.changedFiles.since(ref);
    const workspaces = await this.graph.read();
    const nothingChanged = changed.length === 0;
    const names = nothingChanged
      ? workspaces.map((it) => it.name).sort()
      : [...this.graph.affectedIn(workspaces, changed)].sort();
    const everything = names.length === workspaces.length;

    const projects: string[] = [];
    for (const name of names) {
      const workspace = workspaces.find((it) => it.name === name);
      if (!workspace) {
        continue;
      }
      const config =
        workspace.location === "."
          ? "vitest.config.ts"
          : `${workspace.location}/vitest.config.ts`;
      // A workspace with no config owns no project, and naming one that does
      // not exist fails the whole run with "No projects matched the filter".
      if (await this.fs.exists(config)) {
        projects.push(`${name}*`);
      }
    }

    if (nothingChanged) {
      this.log.info(
        `--affected: nothing changed since ${ref}, so this ref narrows nothing - running the pipeline whole. To verify only what a pull brought in, name the pre-pull commit: --since HEAD@{1}.`,
      );
    } else if (everything) {
      this.log.info(
        `--affected: ${changed.length} changed file(s) since ${ref} reach every workspace, running the pipeline whole`,
      );
    } else {
      this.log.info(
        `--affected: ${changed.length} changed file(s) since ${ref} reach ${names.length}/${workspaces.length} workspace(s): ${names.join(", ") || "none"}`,
      );
    }

    return { names, projects, everything };
  }

  /**
   * The test step, restricted to the affected workspaces.
   *
   * `null` means there is nothing to run, which is a different answer from
   * "run everything" and has to stay different: a change reaching no workspace
   * that owns specs would otherwise run the whole suite or, worse, be handed
   * an empty filter that vitest reads as no filter at all.
   */
  protected testCommand(affected?: AffectedSelection): string | null {
    if (!affected || affected.everything) {
      return `yarn test`;
    }
    if (affected.projects.length === 0) {
      return null;
    }
    return `yarn alepha test --project ${affected.projects.join(",")}`;
  }

  /**
   * A workspace fan-out, restricted to the affected workspaces.
   *
   * `--include` takes one ident per occurrence, so an affected set becomes a
   * repeated flag rather than one comma-joined value.
   */
  protected foreachCommand(
    script: string,
    affected?: AffectedSelection,
  ): string | null {
    if (!affected || affected.everything) {
      return `yarn ${script}`;
    }
    if (affected.names.length === 0) {
      return null;
    }
    const includes = affected.names
      .map((name) => `--include ${name}`)
      .join(" ");
    return `yarn workspaces foreach -Apt ${includes} run ${script}`;
  }

  /**
   * Run a step, or say why it was skipped.
   *
   * A skipped step that prints nothing is indistinguishable from a step that
   * ran and found nothing, which is the whole failure mode an affected-only
   * pipeline has to avoid reporting as success.
   */
  protected async runStep(
    run: (cmd: string) => Promise<unknown>,
    command: string | null,
    skipped: string,
  ): Promise<void> {
    if (command === null) {
      this.log.info(
        `--affected: skipping ${skipped}, nothing affected owns it`,
      );
      return;
    }
    await run(command);
  }

  /**
   * Whether the packed-CLI suite has to run.
   *
   * See the call site: `e2e-cli` has no edge to `alepha` in the graph because
   * it consumes a tarball, not an import, so it is named here explicitly.
   */
  protected runsCliSuite(affected?: AffectedSelection): boolean {
    if (!affected || affected.everything) {
      return true;
    }
    return (
      affected.names.includes("alepha") ||
      affected.names.includes("create-alepha")
    );
  }

  /**
   * Whether something answers on a local port, within a second.
   */
  protected isUp(port: number): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      const socket = connect({ host: "127.0.0.1", port });
      const settle = (up: boolean) => {
        socket.destroy();
        resolve(up);
      };
      socket.setTimeout(1_000);
      socket.once("connect", () => settle(true));
      socket.once("timeout", () => settle(false));
      socket.once("error", () => settle(false));
    });
  }

  /**
   * Refuse to start the suites while any of the test services is down, and
   * name the ones that are.
   */
  protected async assertServicesUp(): Promise<void> {
    const probed = await Promise.all(
      AlephaCommands.services.map(async (it) => ({
        ...it,
        up: await this.isUp(it.port),
      })),
    );

    if (probed.every((it) => it.up)) {
      return;
    }

    const report = probed
      .map(
        (it) =>
          `  ${it.name.padEnd(8)} 127.0.0.1:${it.port}  ${it.up ? "up" : "DOWN"}`,
      )
      .join("\n");

    throw new AlephaError(
      `Test services unreachable:\n${report}\n\n  Start them with:  docker compose up -d`,
    );
  }
}
