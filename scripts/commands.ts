import { connect } from "node:net";

import { AlephaError, z } from "alepha";
import { $command } from "alepha/command";
import { $logger } from "alepha/logger";

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
  ];

  /**
   * The inner loop, and deliberately NOT the gate.
   *
   * ⚠️ **CI is the gate now.** Until 2026-09-09 this command ran the whole
   * pipeline locally - copy, build, e2e, e2e-cli, gen:llms - and that lane is
   * deleted rather than hidden behind a flag, because a flag is a thing an
   * agent reaches for. Measured over 30 days of transcripts before the
   * change: 1,325 full runs across 243 sessions, p50 ~7min and p90 ~14min,
   * 84 machine-hours a month, and **1,082 of those 1,325 (82%) were re-runs
   * inside a single session** - the old lane opened and closed with
   * `yarn clean`, so every re-run was cold by construction. With four epics
   * building at once on one machine that is ~30 minutes of contended wall
   * clock for an answer CI now gives in about five, in parallel, for free.
   *
   * So: push the branch. Every branch triggers the full graph (checks, test
   * x6, e2e-apps, e2e-lore x6, e2e-cli, docker, bay), and that graph - not a
   * green terminal here - is what says the work is sound.
   *
   * What survives is worth about three minutes, measured: ~146s of it is
   * `yarn test`, and lint plus the six parallel audits are under 30s
   * together. It catches a typo, a bad import, a broken unit test, a missing
   * i18n key. It cannot catch a build failure, an SSR regression or anything
   * an e2e covers, and it is not supposed to.
   *
   * `--fast` is accepted and does nothing. It named the distinction between
   * this lane and the full one, and there is no longer a distinction to name;
   * it stays accepted so the call sites already carrying it keep working
   * rather than dying on an unknown flag.
   */
  public readonly verify = $command({
    aliases: ["v"],
    description:
      "Fast local checks: lint, typecheck, audits, unit tests. CI is the gate - push the branch.",
    // One run of this lane per machine, whatever the checkout.
    //
    // The key is derived from the package name and never from the cwd, so
    // every worktree of this repository shares the single slot. That is the
    // point: what two checkouts contend for is not the machine's RAM but the
    // four services `vitest.config.ts` points every one of them at, on fixed
    // ports 15432, 16379 and 19090. `test` and `test:bun` both drive that one
    // postgres, so two concurrent lanes are two suites interleaving in the
    // same database, which is the shape of a flake that never reproduces the
    // same way twice.
    //
    // ⚠️ The reason is NOT the one #Q2148 was written against. That quest
    // argued from memory: three FULL lanes peaked at 48.9 GB against a 48 GB
    // ceiling, driven by `e2e` (13.6 GB) and `build` (7.3 GB), and it said
    // explicitly that the fast lane must stay concurrent because its whole
    // value is failing fast. The full lane was then deleted the same day, so
    // the lane that survives is the one the quest exempted. It still takes the
    // slot, on the service argument above rather than the memory one, and the
    // trade is much better than the one the quest was refusing: a second agent
    // waits out ~3 minutes rather than ~10, and what it was going to get
    // instead was a red run it would have had to re-run anyway.
    //
    // `ALEPHA_NO_EXCLUSIVE=1` bypasses the queue.
    exclusive: true,
    flags: z.object({
      fast: z
        .boolean()
        .describe("Accepted and ignored: this lane is always the fast one.")
        .optional(),
    }),
    handler: async ({ run, flags }) => {
      // We need to force CI environment
      // -> tsdown has different behavior when run in CI
      process.env.CI = "true";

      // When CI=true, yarn might create an immutable install, which is cool, but we don't need that here
      process.env.YARN_ENABLE_IMMUTABLE_INSTALLS = "false";
      process.env.YARN_ENABLE_HARDENED_MODE = "false";

      if (flags.fast) {
        this.log.warn(
          "`--fast` no longer means anything: this lane is always the fast one. Drop the flag.",
        );
      }

      // Install, but never `yarn clean`.
      //
      // The old lane opened with `yarn clean`, which removes every `dist` and
      // every `packages/*/node_modules`. In a gate run once before a commit
      // that was defensible; in a loop run three to eleven times a session it
      // is what made each run cold, and it broke the next command as well - a
      // `yarn e2e` straight after a verify died on `Cannot find module dist`,
      // which reads as a fixture bug rather than as the previous command
      // having deleted the build. An inner loop must not mutate the tree.
      await run("yarn");

      // Nothing generated exists to format in this lane, so `lint` goes
      // first; the deleted full lane had to run `copy` ahead of it.
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

      // Sequential, not a parallel group: `test:bun` drives the same postgres
      // on 15432 as `test` does, so running them together is one process
      // interleaving with itself, and a good suspect for a flake that never
      // reproduces the same way twice.
      await run(`yarn test`);
      await run(`yarn test:bun`);
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
    // No slot. It runs in a container of its own and touches none of the four
    // services, so it has nothing to contend with `verify` over.
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
