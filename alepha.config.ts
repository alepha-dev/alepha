import { connect } from "node:net";

import { type Alepha, AlephaError, z } from "alepha";
import { changelogOptions } from "alepha/cli";
import { $command } from "alepha/command";

export default (alepha: Alepha) => {
  // The changelog is the note that ships with the npm packages, so it lists
  // what npm ships: the `alepha` modules, its `api/*` sub-modules, and every
  // published `@alepha/*` package. Everything else — the apps, the private
  // packages — is invisible here without anyone having to remember it.
  //
  // This was a denylist until 0.25, and the denylist is why `bay`, `pulse`,
  // `sigil`, `ui` and `shop` reached the notes for a release nobody shipped
  // them in: it only ever excluded what someone thought to add, and an app
  // born after the last edit is published by default. An allowlist fails the
  // other way, which is the one you notice — a missing entry gets reported,
  // a leaked one does not.
  //
  // Scopes match on the segment before `/`, so `api` covers `api/users` and
  // `react` covers `react/form`.
  alepha.set(changelogOptions, {
    types: ["feat", "fix"],
    scopes: [
      // alepha — modules
      "api",
      "background",
      "batch",
      "bucket",
      "cache",
      "captcha",
      "cli",
      "command",
      "core",
      "crypto",
      "datetime",
      "email",
      "fake",
      "lock",
      "logger",
      "mcp",
      "orm",
      "queue",
      "react",
      "redis",
      "retry",
      "router",
      "scheduler",
      "security",
      "server",
      "sms",
      "system",
      "topic",
      "websocket",
      // alepha — api sub-modules, also written bare
      "analytics",
      "audits",
      "files",
      "jobs",
      "keys",
      "notifications",
      "oauth",
      "organizations",
      "parameters",
      "payments",
      "subscriptions",
      "users",
      "verifications",
      // published packages
      "devtools",
      "mqtt",
      "payments-stripe",
      "protobuf",
      "sigil",
      "ui",
      // surfaces that live inside a module and are named on their own
      "auth",
      "cookies",
      "platform",
    ],
  });

  return {
    clean: $command({
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
    }),
    "verify:go": $command({
      aliases: ["v:go"],
      // Shares one slot with `verify`, see the note there.
      exclusive: "alepha:verify",
      description: "Run the Go suite (apps/bay) on the platform it ships for.",
      handler: async ({ run }) => {
        // A lane of its own rather than a step inside `verify`, because the two
        // toolchains have nothing to say to each other: every Go file in this
        // repo is `apps/bay`, one module, with no edge into the TypeScript
        // graph. Running it on every `yarn v` meant a container start — ~20s —
        // for a change that could not possibly have touched it, which is most
        // changes.
        //
        // Gating it on `git diff` was the other option and was rejected: a
        // heuristic that misfires skips silently, and a silent skip is exactly
        // the failure this repo keeps paying for. A separate command cannot be
        // silently wrong — Go is either what you asked for or it is not.
        //
        // ⚠️ The trade is real: `yarn v` no longer covers Go. The `bay` CI job
        // runs unconditionally on every PR and push, so nothing reaches main
        // unchecked, but a local green now means less than it did. Touch
        // `apps/bay`, run this.
        //
        // Not the native `go test`: that is GREEN while skipping every test of
        // `Systemd.render()` — the sandbox directives, the memory and CPU
        // ceilings, the stop timeout — because those files are `//go:build
        // linux` and do not compile on the machine this is usually run from.
        // `test:linux` reproduces the `bay` CI job in a container: gofmt, vet,
        // build, the whole suite, and a cross-compile for both Linux
        // architectures.
        await run(`yarn w bay test:linux`);
      },
    }),
    verify: $command({
      aliases: ["v"],
      // One machine-wide slot, shared with `verify:go`, because what these two
      // contend for is the machine rather than the lane. `vitest.config.ts`
      // points every checkout at the SAME services: postgres on 15432, redis
      // on 16379, s3mock on 19090, emqx on 11883, one database and one bucket
      // between them. Two worktrees running `yarn v` at once therefore
      // interleave writes into a single postgres, which is the likeliest cause
      // of the intermittent, never-the-same-spec failures this pipeline used
      // to produce. The CPU cost of two concurrent typecheck/test/build runs
      // is the smaller half of the problem.
      //
      // An explicit key rather than `true`: `true` derives from the command
      // name, which would hand these two lanes separate slots.
      exclusive: "alepha:verify",
      description:
        "Run linter, checker and tests (JavaScript/TypeScript only — Go lives in `v:go`).",
      flags: z.object({
        fast: z
          .boolean()
          .describe("Skip build + e2e (faster local sanity check).")
          .optional(),
      }),
      handler: async ({ run, flags }) => {
        // The services `vitest.config.ts` points at — exactly the set `compose.yml`
        // provides. When they are down, the suite fails with hundreds of opaque
        // PostgresError/S3NetworkError lines that name no cause, so probe first
        // and say the one thing worth saying.
        const services = [
          { name: "postgres", port: 15432 },
          { name: "redis", port: 16379 },
          { name: "s3mock", port: 19090 },
          { name: "emqx", port: 11883 },
        ];

        const isUp = (port: number) =>
          new Promise<boolean>((resolve) => {
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

        const assertServicesUp = async () => {
          const probed = await Promise.all(
            services.map(async (it) => ({ ...it, up: await isUp(it.port) })),
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
        };

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
          // `lint` can go first — see the full path below for why the order
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
          await assertServicesUp();
          await run([`yarn test`, `yarn test:bun`]);
          return;
        }

        // Deliberately serial, and measured rather than assumed.
        //
        // Grouping these was tried and reverted. On a saturated machine
        // parallelism does not compose: run as one group they finished in
        // 16.8s against 18.4s serial — 1.6s — while `check:deps` alone went
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
        await assertServicesUp();

        await run(`yarn check:i18n`);
        await run(`yarn check:migrations`);

        // `test` genuinely does not need `build`, and pairing them still lost:
        // together they took 129.4s against 142.3s serial, because `test` alone
        // stretched from 47.4s to 115.6s under the contention. Thirteen seconds
        // is not worth a test run that takes two and a half times as long to
        // tell you it failed.
        await run(`yarn test`);
        await run(`yarn test:bun`);
        await run(`yarn build`);

        // Give the one dev-mode e2e suite a cold Vite cache. Only
        // `apps/examples/ssr/playwright.dev.config.ts` runs `yarn dev` — every
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

        await run(`cd apps/docs && yarn alepha gen:llms`);
        await run(`yarn clean`);
        await run("yarn");
      },
    }),
  };
};
