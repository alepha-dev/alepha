import { connect } from "node:net";

import { AlephaError, z } from "alepha";
import { $command } from "alepha/command";

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
    description:
      "Run linter, checker and tests (JavaScript/TypeScript only, Go lives in `v:go`).",
    flags: z.object({
      fast: z
        .boolean()
        .describe("Skip build + e2e (faster local sanity check).")
        .optional(),
    }),
    handler: async ({ run, flags }) => {
      // We need to force CI environment
      // -> tsdown has different behavior when run in CI
      process.env.CI = "true";

      // When CI=true, yarn might create an immutable install, which is cool, but we don't need that here
      process.env.YARN_ENABLE_IMMUTABLE_INSTALLS = "false";
      process.env.YARN_ENABLE_HARDENED_MODE = "false";

      await run("yarn");
      await run(`yarn clean`);

      if (flags.fast) {
        // No `copy` in this lane, so nothing generated exists to format and
        // `lint` can go first: see the full path below for why the order
        // matters there.
        await run(`yarn lint`);
        await run([
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
        // postgres on 15432 as `test` does. This is the lane used as the gate
        // before a commit, which makes it a good suspect for a flake that
        // never reproduces the same way twice.
        await run(`yarn test`);
        await run(`yarn test:bun`);
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
      await run(`yarn copy`);

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
      await run(`yarn lint`);

      // After `copy` for the same reason: checking before it would validate
      // a stale copy and miss a doc-breaking comment change.
      await run(`yarn check:docs`);
      await run(`yarn check:deps`);
      await run(`yarn check:conventions`);
      await run(`yarn typecheck`);
      await this.assertServicesUp();

      await run(`yarn check:i18n`);
      await run(`yarn check:migrations`);

      // `test` genuinely does not need `build`, and pairing them still lost:
      // together they took 129.4s against 142.3s serial, because `test` alone
      // stretched from 47.4s to 115.6s under the contention. Thirteen seconds
      // is not worth a test run that takes two and a half times as long to
      // tell you it failed.
      //
      // Two calls rather than `run([a, b])` for `test` and `test:bun`:
      // `run([a, b])` is `Promise.all`, and these two drive the same postgres,
      // so running them together is one process interleaving with itself.
      await run(`yarn test`);
      await run(`yarn test:bun`);
      await run(`yarn build`);

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
      await run([`yarn e2e`, `yarn e2e-cli`]);

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
      await run(`yarn w bay test:linux`);
    },
  });

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
