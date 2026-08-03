import { connect } from "node:net";
import { type Alepha, AlephaError, z } from "alepha";
import { changelogOptions } from "alepha/cli";
import { $command } from "alepha/command";

export default (alepha: Alepha) => {
  // Type-safe changelog configuration
  alepha.set(changelogOptions, {
    ignore: [
      "project",
      "tests",
      "docs",
      "release",
      "task",
      "lore",
      "lore/admin",
      "lore/cli",
      "lore/db",
      "playground",
      "platform-lib",
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
          `apps/*/playwright-report`,
          `apps/*/test-results`,
          `apps/*/.playwright`,
          `apps/*/dist`,
          `apps/*/coverage`,
          `packages/*/dist`,
          `packages/*/node_modules`,
          `packages/*/coverage`,
        ]);
      },
    }),
    verify: $command({
      aliases: ["v"],
      description: "Run linter, checker and tests.",
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
        await run(`yarn lint`);

        if (flags.fast) {
          await run([
            `yarn typecheck`,
            `yarn check:deps`,
            `yarn check:conventions`,
            `yarn check:docs`,
            `yarn check:i18n`,
            `yarn check:migrations`,
            // The native Go pass, ~4s. Partial by construction: on macOS,
            // `internal/runner/systemd_test.go` is `//go:build linux`, so 7 of
            // that package's 12 tests are not compiled and `ok` is printed
            // anyway. The full pass runs in a container below, out of --fast.
            `yarn w bay test`,
          ]);
          await assertServicesUp();
          await run([`yarn test`, `yarn test:bun`]);
          return;
        }

        await run(`yarn copy`);
        // After `copy`: docs/2-reference and docs/3-packages are generated
        // from source JSDoc, so checking before it would validate a stale
        // copy and miss a doc-breaking comment change.
        await run(`yarn check:docs`);
        await run(`yarn check:deps`);
        await run(`yarn check:conventions`);
        await run(`yarn typecheck`);
        await assertServicesUp();

        // Bay's suite, on the platform it ships for. ~18s in a container.
        //
        // A superset of `yarn w bay test`, not a repeat of it: gofmt, vet,
        // build, the whole test suite and a cross-compile for both Linux
        // architectures — the same steps as the `bay` CI job. It is here rather
        // than in --fast because it costs a container start, and it is here at
        // all because a native `go test` is GREEN while skipping every test of
        // `Systemd.render()`: the sandbox directives, the memory and CPU
        // ceilings, the stop timeout. Those files are `//go:build linux` and do
        // not exist on the machine this is usually run from.
        await run(`yarn w bay test:linux`);

        await run(`yarn test`);
        await run(`yarn test:bun`);
        await run(`yarn check:i18n`);
        await run(`yarn check:migrations`);
        await run(`yarn build`);

        // HACK: remove vite cache to prevent stale cache issues in e2e tests
        await run.rm([`apps/*/node_modules/.vite`]);
        await run(`yarn e2e`);
        await run(`yarn e2e-cli`);

        await run(`cd apps/docs && yarn alepha gen:llms`);
        await run(`yarn clean`);
        await run("yarn");
      },
    }),
  };
};
