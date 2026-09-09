import { Alepha } from "alepha";
import { CliProvider } from "alepha/command";
import { HttpError } from "alepha/server";
import {
  FileSystemProvider,
  MemoryFileSystemProvider,
  MemoryShellProvider,
  ShellProvider,
} from "alepha/system";
import { describe, expect, it } from "vitest";

import { AppsCommand } from "../commands/AppsCommand.ts";

/**
 * `lore apps`: which targets a build produces, and what a deploy is allowed to
 * do on its own.
 *
 * ⚠️ **The two load-bearing cases.** For `build`, that two envs on one estate
 * type give byte-identical output - a value frozen into a stored artifact
 * breaks promotion, which is the whole reason the registry exists. For
 * `deploy`, that a named `--tag` never builds and never mints an instance -
 * the first would ship different bytes under a tested name, the second would
 * turn a typo in `--env` into a deploy target.
 */
const create = (
  instances: Record<string, { id?: string; estateId?: string }> = {},
  estates: Array<{ id: string; acceptedRuntimes: string[] }> = [],
  deploy: {
    /**
     * What `getDeployment` answers, one entry per poll. The last is
     * repeated, so a run that is already terminal needs a single entry.
     */
    runs?: Array<Record<string, unknown>>;
    /**
     * What `startDeploy` throws instead of answering - the server's own
     * refusal, which is the thing this client has to surface in words.
     */
    refusal?: unknown;
  } = {},
) => {
  const alepha = Alepha.create({
    env: {
      LOG_LEVEL: "error",
      LORE_API_KEY: "k",
      LORE_URL: "",
      LORE_PROJECT: "alepha",
      LORE_APP: "",
      LORE_ENV: "",
      HOME: "/nonexistent",
    },
  })
    .with({ provide: FileSystemProvider, use: MemoryFileSystemProvider })
    .with({ provide: ShellProvider, use: MemoryShellProvider });

  const fs = alepha.inject(MemoryFileSystemProvider);
  const shell = alepha.inject(MemoryShellProvider);
  const cli = alepha.inject(CliProvider);
  const command = alepha.inject(AppsCommand);

  /**
   * What the deploy half did, in the order it did it.
   *
   * Each entry records how many shell commands and how many nested command
   * runs had already happened, which is what turns "all three steps
   * happened" into "in that order".
   */
  const started: Array<{
    instanceId: string;
    body: Record<string, unknown>;
    shellCalls: number;
    pushes: number;
  }> = [];
  const ran: Array<{
    command: unknown;
    name: string;
    argv?: string;
    shellCalls: number;
  }> = [];
  const printed: string[] = [];
  const runs = deploy.runs ?? [{ status: "succeeded" }];
  let read = 0;
  // A clock the test owns. `wait` advancing it is what lets a poll loop run
  // to its end, and to its timeout, without a real second passing.
  let clock = 0;

  Object.assign(command as unknown as Record<string, unknown>, {
    apps: {
      getApp: async ({ params }: { params: { env: string } }) => {
        const found = instances[params.env];
        if (!found) {
          // What the real client does with `AppService.load`'s 404, which is
          // the case that must never become a create.
          throw new HttpError({ status: 404, message: "App not found" });
        }
        return found;
      },
    },
    estates: {
      listProjectEstates: async () => ({ items: estates }),
    },
    deploys: {
      startDeploy: async ({
        params,
        body,
      }: {
        params: { instanceId: string };
        body: Record<string, unknown>;
      }) => {
        if (deploy.refusal) {
          throw deploy.refusal;
        }
        started.push({
          instanceId: params.instanceId,
          body,
          shellCalls: shell.calls.length,
          pushes: ran.length,
        });
        return { id: "dep-1", status: "queued" };
      },
      getDeployment: async () => runs[Math.min(read++, runs.length - 1)],
    },
    cli: {
      run: async (
        nested: { name: string },
        options: { argv?: string } = {},
      ) => {
        ran.push({
          command: nested,
          name: nested.name,
          argv: options.argv,
          shellCalls: shell.calls.length,
        });
      },
    },
    dateTime: {
      nowMillis: () => clock,
      wait: async (ms: number) => {
        clock += ms;
      },
    },
    log: {
      info: (message: string) => printed.push(message),
      warn: () => {},
      error: () => {},
      debug: () => {},
      trace: () => {},
    },
    projects: {
      resolve: async () => 1,
      resolveApp: async () => "docs",
      // The real chain, minus its remote read: `--env`, `LORE_ENV`, then the
      // app's own rows. The empty string is what a present-but-empty CI
      // variable looks like, and `||` is what keeps it from resolving. With no
      // rows faked here it answers `production`, which is what the real one
      // does for an app that has none - and which `loadInstance` then refuses
      // unless a case put `production` in `instances`.
      resolveEnv: async (flag?: string) => flag || "production",
    },
  });

  return { alepha, fs, shell, cli, command, started, ran, printed };
};

/**
 * A workspace the build can run in, with a `dist/` the build writes into.
 */
const aWorkspace = async (fs: MemoryFileSystemProvider) => {
  await fs.writeFile("/project/package.json", JSON.stringify({ name: "docs" }));
  await fs.writeFile("/project/dist/index.js", "console.log(1);");
  await fs.writeFile(
    "/project/dist/manifest.json",
    JSON.stringify({ version: 1, runtime: "workerd", project: "docs" }),
  );
};

const commandsOf = (shell: MemoryShellProvider) =>
  shell.calls.map((it) => it.command);

describe("lore apps build", () => {
  it("builds what the local config declares when nothing narrows", async () => {
    // ⚠️ The offline path, and the only one that needs no network at all.
    // `alepha build` with no `-t` is what reads the config's own target.
    const { fs, shell, cli, command } = create();
    await aWorkspace(fs);

    await cli.run(command.build, { root: "/project", argv: "" });

    expect(commandsOf(shell)).toContain("npx alepha build");
  });

  it("builds each target of a comma-separated list", async () => {
    const { fs, shell, cli, command } = create();
    await aWorkspace(fs);

    await cli.run(command.build, {
      root: "/project",
      argv: "--target cloudflare,bare --tag 0.28.0",
    });

    expect(commandsOf(shell)).toContain("npx alepha build -t cloudflare");
    // ⚠️ `bare` says its runtime out loud: the target alone leaves it at the
    // default, and a manifest naming the wrong runtime lands the push under
    // the wrong identity.
    expect(commandsOf(shell)).toContain(
      "npx alepha build -t bare --runtime node",
    );
  });

  it("leaves the build in dist/ and puts nothing else there", async () => {
    // ⚠️ It used to copy `dist/` into `dist/<app>_<target>_<tag>`, which Node
    // refuses outright (`EINVAL: cannot copy to a subdirectory of self`), so
    // `lore apps build` failed on every real filesystem. The spec passed
    // because `MemoryFileSystemProvider.cp` allows a destination inside its
    // own source.
    //
    // Relocating that copy would not have been enough either. Nothing ever
    // read it - `lore artifacts push` packs `root/dist` and takes no other
    // directory - and `WorkspacePacker` tars the whole of `dist/`, so a copy
    // left in there rode inside the next artifact and doubled it.
    const { fs, cli, command } = create();
    await aWorkspace(fs);

    await cli.run(command.build, {
      root: "/project",
      argv: "--target cloudflare --tag 0.28.0",
    });

    expect(await fs.exists("/project/dist/index.js")).toBe(true);
    expect(await fs.exists("/project/dist/docs_cloudflare_0.28.0")).toBe(false);
  });

  describe("--env", () => {
    const twoCloudflareEnvs = () =>
      create(
        {
          staging: { estateId: "e1" },
          production: { estateId: "e2" },
        },
        [
          { id: "e1", acceptedRuntimes: ["workerd"] },
          { id: "e2", acceptedRuntimes: ["workerd"] },
        ],
      );

    it("selects a target and nothing else", async () => {
      const { fs, shell, cli, command } = create(
        { yyy: { estateId: "bay-1" } },
        [{ id: "bay-1", acceptedRuntimes: ["node"] }],
      );
      await aWorkspace(fs);

      await cli.run(command.build, { root: "/project", argv: "--env yyy" });

      expect(commandsOf(shell)).toContain(
        "npx alepha build -t bare --runtime node",
      );
    });

    /**
     * ⚠️ **The test that separates the flag from the thing it must not be.**
     * If `--env staging` and `--env production`, both Cloudflare, give
     * different bytes, `--env` has started threading an env-specific value
     * into the build and promotion across environments is broken.
     */
    it("gives byte-identical output for two envs on one estate type", async () => {
      const staging = twoCloudflareEnvs();
      await aWorkspace(staging.fs);
      await staging.cli.run(staging.command.build, {
        root: "/project",
        argv: "--env staging --tag 0.28.0",
      });

      const production = twoCloudflareEnvs();
      await aWorkspace(production.fs);
      await production.cli.run(production.command.build, {
        root: "/project",
        argv: "--env production --tag 0.28.0",
      });

      // The build command line is the whole of what an env can influence, and
      // it carries a target and nothing else.
      const build = (shell: MemoryShellProvider) =>
        commandsOf(shell).filter((it) => it.startsWith("npx alepha build"));
      expect(build(staging.shell)).toEqual(build(production.shell));
      expect(build(staging.shell)).toEqual(["npx alepha build -t cloudflare"]);
    });

    it("refuses an --env that contradicts --target", async () => {
      // A conflict, not a precedence question: silently picking one produces
      // bytes the operator did not ask for and a deploy that fails much later.
      const { fs, cli, command } = create({ xxx: { estateId: "cf-1" } }, [
        { id: "cf-1", acceptedRuntimes: ["workerd"] },
      ]);
      await aWorkspace(fs);

      await expect(
        cli.run(command.build, {
          root: "/project",
          argv: "--env xxx --target docker",
        }),
      ).rejects.toThrowError(
        /--env xxx needs `--target cloudflare`, but --target says `docker`/,
      );
    });

    it("refuses an env whose copy has no estate", async () => {
      // Refused, not fallen back on: building every target for an environment
      // that names no estate produces bytes nobody asked for and hides the
      // real problem.
      const { fs, cli, command } = create({ zzz: {} }, []);
      await aWorkspace(fs);

      await expect(
        cli.run(command.build, { root: "/project", argv: "--env zzz" }),
      ).rejects.toThrowError(/has no estate/);
    });
  });
});

/**
 * `lore apps deploy`: the tag is the switch.
 *
 * ⚠️ Every refusal here is a case where the wrong behaviour is invisible until
 * production: a rebuild under a tested tag ships different bytes with nothing
 * on screen saying so, and a minted instance turns `--env prod` into a second
 * deploy target beside `production`.
 */
describe("lore apps deploy", () => {
  const aCloudflareCopy = (
    runs?: Array<Record<string, unknown>>,
    refusal?: unknown,
  ) =>
    create(
      { production: { id: "inst-1", estateId: "cf-1" } },
      [{ id: "cf-1", acceptedRuntimes: ["workerd"] }],
      { runs, refusal },
    );

  it("builds, pushes and deploys, in that order, when no tag is named", async () => {
    const { fs, shell, cli, command, started, ran } = aCloudflareCopy();
    await aWorkspace(fs);

    await cli.run(command.deploy, {
      root: "/project",
      argv: "--env production",
    });

    // The build is the env's implied target, and nothing else.
    expect(commandsOf(shell)).toEqual(["npx alepha build -t cloudflare"]);
    // ⚠️ Ordering, not merely occurrence: the push saw the build's shell call
    // already made, and the deploy saw the push already run.
    expect(ran[0].shellCalls).toBe(1);
    expect(started[0].pushes).toBe(1);
    expect(started[0].shellCalls).toBe(1);
    expect(started[0].body).toEqual({ tag: "latest" });
  });

  it("deploys the stored artifact under --tag and never builds", async () => {
    // ⚠️ The rule the artifact registry exists for. CI pushed `0.28.0` from a
    // clean checkout; promoting it must not rebuild from this machine.
    const { fs, shell, cli, command, started, ran } = aCloudflareCopy();
    await aWorkspace(fs);

    await cli.run(command.deploy, {
      root: "/project",
      argv: "--env production --tag 0.28.0",
    });

    expect(commandsOf(shell)).toEqual([]);
    expect(ran).toEqual([]);
    expect(started[0].body).toEqual({ tag: "0.28.0" });
  });

  it("refuses a --tag with no artifact rather than building one", async () => {
    // The server is what knows; the client's job is to not paper over it by
    // falling back to a build, which is the one recovery that looks helpful.
    const { fs, shell, cli, command } = aCloudflareCopy(undefined, {
      status: 404,
      message:
        "docs has no artifact tagged '9.9.9'. Push one with `lore artifacts push`, or deploy a tag that exists.",
    });
    await aWorkspace(fs);

    await expect(
      cli.run(command.deploy, {
        root: "/project",
        argv: "--env production --tag 9.9.9",
      }),
    ).rejects.toThrow(/has no artifact tagged '9.9.9'/);
    expect(commandsOf(shell)).toEqual([]);
  });

  it("refuses an env with no instance row, and mints nothing", async () => {
    // ⚠️ The near-miss is the case that matters. `app_instances` is unique on
    // `(projectId, app, env)` and each half is lowercased, so `--env Production`
    // lands on the existing row while `--env prod` does not - and creating one
    // as a side effect of the typo is how `clbu` gets deployed to.
    const { fs, shell, cli, command, started } = aCloudflareCopy();
    await aWorkspace(fs);

    await expect(
      cli.run(command.deploy, { root: "/project", argv: "--env prod" }),
    ).rejects.toThrow(/docs\/prod is not a deployed copy of this project/);
    expect(started).toEqual([]);
    expect(commandsOf(shell)).toEqual([]);
  });

  it("names a project, an app and an environment, and no estate", async () => {
    // ⚠️ Structural, not a validation: a client that can name its own estate
    // can deploy into somebody else's cloud account (folio #96).
    const { fs, cli, command, started } = aCloudflareCopy();
    await aWorkspace(fs);

    await cli.run(command.deploy, {
      root: "/project",
      argv: "--env production",
    });

    // ⚠️ The whole surface, so `--estate` cannot be added without this
    // failing. `--sigil` is here because it names a credential Lore mints for
    // this copy; an estate is somebody's cloud account, which is the thing a
    // client must never get to choose.
    expect(Object.keys(command.deploy.flags?.shape ?? {}).sort()).toEqual([
      "app",
      "env",
      "project",
      "sigil",
      "tag",
    ]);
    // The whole body, so an estate id cannot be added without this failing.
    expect(started[0].body).toEqual({ tag: "latest" });
    expect(started[0].instanceId).toBe("inst-1");
  });

  it("pushes through `lore artifacts push` rather than a second uploader", async () => {
    const { fs, cli, command, ran } = aCloudflareCopy();
    await aWorkspace(fs);

    await cli.run(command.deploy, {
      root: "/project",
      argv: "--env production",
    });

    expect(ran).toHaveLength(1);
    expect(ran[0].name).toBe("push");
    // Identity, not just the name: this is the artifacts command's own child.
    expect(ran[0].command).toBe(
      (command as unknown as { artifactCommand: { push: unknown } })
        .artifactCommand.push,
    );
    expect(ran[0].argv).toBe("--project alepha --app docs --tag latest");
  });

  it("streams the run's log and stops at the terminal status", async () => {
    const { fs, cli, command, printed } = aCloudflareCopy([
      { status: "running", log: [{ text: "uploading" }] },
      {
        status: "succeeded",
        url: "https://docs.example.com",
        log: [{ text: "uploading" }, { text: "live" }],
      },
    ]);
    await aWorkspace(fs);

    await cli.run(command.deploy, {
      root: "/project",
      argv: "--env production --tag 0.28.0",
    });

    // Each line once, in order, and never re-printed on the next poll.
    expect(printed.filter((it) => it === "uploading")).toHaveLength(1);
    expect(printed).toContain("live");
    expect(printed.at(-1)).toContain("https://docs.example.com");
  });

  it("exits non-zero on a failed run, naming why", async () => {
    // ⚠️ This runs in CI: returning normally would report a failed deploy as a
    // green pipeline step.
    const { fs, cli, command } = aCloudflareCopy([
      { status: "failed", error: "The Worker upload was rejected." },
    ]);
    await aWorkspace(fs);

    await expect(
      cli.run(command.deploy, {
        root: "/project",
        argv: "--env production --tag 0.28.0",
      }),
    ).rejects.toThrow(/The Worker upload was rejected\./);
  });

  it("gives the gate's own words, not a status code", async () => {
    // The person deploying is often not the person who can fix this, so the
    // message naming whose estate it is has to survive the trip.
    const { fs, cli, command } = aCloudflareCopy(undefined, {
      status: 400,
      message:
        "The estate 'nfo-cf' does not accept deploys. Its owner can turn that on from their Estates page.",
    });
    await aWorkspace(fs);

    await expect(
      cli.run(command.deploy, {
        root: "/project",
        argv: "--env production --tag 0.28.0",
      }),
    ).rejects.toThrow(
      /The estate 'nfo-cf' does not accept deploys\. Its owner can turn that on/,
    );
  });

  it("refuses an environment that names no copy, before building anything", async () => {
    // ⚠️ Where the zero-rows case lands. `resolveEnv` answers `production` for
    // an app with no rows rather than refusing itself, precisely so the
    // refusal is THIS one - it names the pair and where to make it, which is
    // what somebody who typed a near-miss needs.
    //
    // ⚠️ And it happens before the build. A refusal after the build would have
    // shipped the working tree into an artifact for a copy that does not
    // exist.
    const { fs, cli, command, started, shell } = create(
      // Every other env exists; `production`, which the fake chain resolves to,
      // does not.
      { staging: { id: "inst-2", estateId: "cf-1" } },
      [{ id: "cf-1", acceptedRuntimes: ["workerd"] }],
    );
    await aWorkspace(fs);

    await expect(
      cli.run(command.deploy, { root: "/project", argv: "" }),
    ).rejects.toThrow(
      /docs\/production is not a deployed copy of this project/,
    );
    expect(started).toEqual([]);
    expect(commandsOf(shell)).toEqual([]);
  });

  it("runs the same deploy from the top-level `lore deploy`", async () => {
    // ⚠️ Two `$command`s over one handler, so this is not a second code path -
    // and this case is what proves the promoted primitive is actually wired to
    // it rather than merely registered.
    const { fs, cli, command, started } = aCloudflareCopy();
    await aWorkspace(fs);

    await cli.run(command.deployCommand, {
      root: "/project",
      argv: "--env production --tag 0.28.0",
    });

    expect(started).toHaveLength(1);
    expect(started[0]).toMatchObject({
      instanceId: "inst-1",
      body: { tag: "0.28.0" },
    });
  });

  it("stops following after its own timeout, saying the run continues", async () => {
    const { fs, cli, command } = aCloudflareCopy([{ status: "running" }]);
    await aWorkspace(fs);

    await expect(
      cli.run(command.deploy, {
        root: "/project",
        argv: "--env production --tag 0.28.0",
      }),
    ).rejects.toThrow(/still running/);
  });
});

describe("lore apps destroy", () => {
  const aCloudflareCopy = () =>
    create({ production: { id: "inst-1", estateId: "cf-1" } }, [
      { id: "cf-1", acceptedRuntimes: ["workerd"] },
    ]);

  /**
   * ⚠️ The accident this exists to prevent. `deploy` falls back to LORE_ENV and
   * then to the app's only environment - which for most apps IS production - so
   * on a command that deletes things a forgotten flag would mean destroying
   * production with the word never appearing on screen.
   */
  it("refuses without --env, and does not fall back to a default", async () => {
    const { fs, cli, command } = aCloudflareCopy();
    await aWorkspace(fs);

    await expect(
      cli.run(command.destroy, {
        root: "/project",
        argv: "--confirm docs/production",
      }),
    ).rejects.toThrowError(/Name the copy with --env/);
  });

  /**
   * ⚠️ The confirmation is TYPED, never composed. Deriving it from `--env`
   * would make the server's check tautological: a wrong `--env` would confirm
   * itself and destroy a copy nobody named.
   */
  it("refuses when the confirmation does not name this copy", async () => {
    const { fs, cli, command } = aCloudflareCopy();
    await aWorkspace(fs);

    await expect(
      cli.run(command.destroy, {
        root: "/project",
        argv: "--env production --confirm docs/staging",
      }),
    ).rejects.toThrowError(/Pass --confirm "docs\/production"/);
  });

  it("refuses with no confirmation at all", async () => {
    const { fs, cli, command } = aCloudflareCopy();
    await aWorkspace(fs);

    await expect(
      cli.run(command.destroy, { root: "/project", argv: "--env production" }),
    ).rejects.toThrowError(/Pass --confirm/);
  });

  /**
   * ⚠️ `--yes` is gone on purpose. A flag that means "skip the check" IS the
   * accident, because it is the flag people leave in a shell history.
   */
  it("has no flag that skips the confirmation", async () => {
    const { command } = aCloudflareCopy();
    const flags = Object.keys(command.destroy.flags?.shape ?? {}).sort();

    expect(flags).toEqual(["app", "confirm", "env", "project"]);
    expect(flags).not.toContain("yes");
    expect(flags).not.toContain("force");
  });
});
