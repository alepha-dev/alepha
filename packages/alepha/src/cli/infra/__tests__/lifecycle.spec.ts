import { Alepha, AlephaError, z } from "alepha";
import { AlephaCli } from "alepha/cli";
import { type AppEntry } from "alepha/cli";
import { defineConfig } from "alepha/cli/config";
import { CliProvider } from "alepha/command";
import { FileSystemProvider, MemoryFileSystemProvider } from "alepha/system";
import { describe, it } from "vitest";

import {
  InfraAdapter,
  type InfraContext,
  type InfraState,
} from "../../infra-lib/adapters/InfraAdapter.ts";
import { infraOptions } from "../../infra-lib/atoms/infraOptions.ts";
import type { ResolvedInfraConfig } from "../../infra-lib/services/InfraInspector.ts";
import { InfraCommand } from "../commands/infra.ts";
import { infra } from "../index.ts";

class RecordingAdapter extends InfraAdapter {
  static readonly id = "external";
  static readonly options = z.object({});
  readonly calls: string[] = [];
  readonly contexts: InfraContext[] = [];
  fail?: string;
  protected step(name: string, ctx: InfraContext): void {
    this.calls.push(name);
    this.contexts.push(ctx);
    if (this.fail === name) throw new AlephaError(`Failed ${name}`);
  }
  async authenticate(ctx: InfraContext) {
    this.step("authenticate", ctx);
  }
  async provision(ctx: InfraContext) {
    this.step("provision", ctx);
  }
  async build(ctx: InfraContext) {
    this.step("build", ctx);
  }
  async migrate(ctx: InfraContext) {
    this.step("migrate", ctx);
  }
  async deploy(ctx: InfraContext) {
    this.step("deploy", ctx);
    return "https://deployed.example";
  }
  async secrets(ctx: InfraContext) {
    this.step("secrets", ctx);
  }
  async login(ctx: InfraContext) {
    this.step("login", ctx);
  }
  async logout(ctx: InfraContext) {
    this.step("logout", ctx);
  }
  async teardown(ctx: InfraContext) {
    this.step("teardown", ctx);
  }
  async inspect(): Promise<InfraState> {
    return {
      workers: [],
      databases: [],
      buckets: [],
      kvNamespaces: [],
      queues: [],
      secrets: [],
    };
  }
}

class TestInfraCommand extends InfraCommand {
  readonly granularDeploy = this.deployOnly;
  readonly granularBuild = this.build;
  readonly login = this.authLogin;
  readonly logout = this.authLogout;
  readonly teardown = this.down;
  readonly boots: Array<{ prebuilt?: boolean }> = [];
  protected override async resolveApp(
    root: string,
    _config: ResolvedInfraConfig,
    _serverless: boolean,
    options: { prebuilt?: boolean } = {},
  ) {
    this.boots.push(options);
    return {
      entry: { root, server: "src/main.server.ts" } satisfies AppEntry,
      resources: {
        hasDatabase: false,
        hasBucket: false,
        hasAnalytics: false,
        hasKV: false,
        hasQueue: false,
        hasCron: false,
      },
    };
  }
}

class TestCli extends CliProvider {
  readonly roots = this.getTopLevelCommands.bind(this);
}

const setup = (configured = true) => {
  const alepha = Alepha.create()
    .with({ provide: FileSystemProvider, use: MemoryFileSystemProvider })
    .with({ provide: CliProvider, use: TestCli })
    .with({ provide: InfraCommand, use: TestInfraCommand })
    .with(AlephaCli);
  if (configured) {
    defineConfig({
      plugins: [
        infra({
          name: "demo",
          environments: {
            production: { adapter: RecordingAdapter, options: {} },
            staging: { adapter: RecordingAdapter, options: {} },
          },
        }),
      ],
    })(alepha);
  }
  return {
    alepha,
    cli: alepha.inject(TestCli),
    command: alepha.inject(TestInfraCommand),
    adapter: alepha.inject(RecordingAdapter),
  };
};

describe("Infra and Deploy lifecycle", () => {
  it("discovers both roots once with or without configured infra", ({
    expect,
  }) => {
    for (const configured of [false, true]) {
      const { cli } = setup(configured);
      const names = cli.roots().map((entry) => entry.name);
      expect(names.filter((name) => name === "deploy")).toHaveLength(1);
      expect(names.filter((name) => name === "infra")).toHaveLength(1);
      expect(names).not.toContain("platform");
      expect(names).not.toContain("p");
    }
  });

  it("shows bare infra help without config or source boot", async ({
    expect,
  }) => {
    const { cli, command, adapter } = setup(false);
    await cli.run(command.infra, { root: "/project" });
    expect(command.boots).toEqual([]);
    expect(adapter.calls).toEqual([]);
  });

  it("requires canonical config before any operation or boot", async ({
    expect,
  }) => {
    const { cli, command, adapter } = setup(false);
    await expect(cli.run(command.deploy, { root: "/project" })).rejects.toThrow(
      /defineConfig[\s\S]*alepha\/cli\/infra[\s\S]*production: cloudflare/,
    );
    expect(command.boots).toEqual([]);
    expect(adapter.calls).toEqual([]);
  });

  it("refuses an empty explicit environment map with canonical guidance", async ({
    expect,
  }) => {
    const { alepha, cli, command, adapter } = setup();
    alepha.set(infraOptions, { environments: {} });
    await expect(cli.run(command.deploy, { root: "/project" })).rejects.toThrow(
      /Missing infra configuration/,
    );
    expect(command.boots).toEqual([]);
    expect(adapter.calls).toEqual([]);
  });

  for (const argv of [
    "",
    "--env staging",
    "--env=staging",
    "-e staging",
    "--prebuilt",
  ]) {
    it(`runs the complete existing pipeline for ${argv || "the default"}`, async ({
      expect,
    }) => {
      const { cli, command, adapter } = setup();
      await cli.run(command.deploy, { root: "/project", argv });
      expect(adapter.calls).toEqual([
        "authenticate",
        "provision",
        "build",
        "migrate",
        "deploy",
        "secrets",
      ]);
      expect(
        adapter.contexts.every(
          (ctx) =>
            ctx.env === (argv.includes("staging") ? "staging" : "production"),
        ),
      ).toBe(true);
      expect(adapter.contexts[2]?.prebuilt).toBe(
        argv.includes("prebuilt") ? true : undefined,
      );
    });
  }

  for (const step of [
    "authenticate",
    "provision",
    "build",
    "migrate",
    "deploy",
    "secrets",
  ]) {
    it(`stops the full pipeline when ${step} fails`, async ({ expect }) => {
      const { cli, command, adapter } = setup();
      adapter.fail = step;
      await expect(
        cli.run(command.deploy, { root: "/project" }),
      ).rejects.toThrow(`Failed ${step}`);
      const order = [
        "authenticate",
        "provision",
        "build",
        "migrate",
        "deploy",
        "secrets",
      ];
      expect(adapter.calls).toEqual(order.slice(0, order.indexOf(step) + 1));
    });
  }

  it("honors an explicitly configured arbitrary default environment", async ({
    expect,
  }) => {
    const { alepha, cli, command, adapter } = setup();
    alepha.set(infraOptions, {
      name: "demo",
      default: "prod",
      environments: { prod: { adapter: RecordingAdapter, options: {} } },
    });
    await cli.run(command.deploy, { root: "/project" });
    expect(adapter.contexts.every((ctx) => ctx.env === "prod")).toBe(true);
    await expect(
      cli.run(command.deploy, { root: "/project", argv: "--env production" }),
    ).rejects.toThrow(/Unknown environment/);
  });

  it("keeps granular deploy at authentication and deployment only", async ({
    expect,
  }) => {
    const { cli, command, adapter } = setup();
    await cli.run(command.granularDeploy, { root: "/project" });
    expect(adapter.calls).toEqual(["authenticate", "deploy"]);
    expect(command.boots).toEqual([{ prebuilt: false }]);
    await expect(
      cli.run(command.granularDeploy, { root: "/project", argv: "--prebuilt" }),
    ).rejects.toThrow(/Unknown flag/);
  });

  it("keeps granular build at the adapter build method only", async ({
    expect,
  }) => {
    const { cli, command, adapter } = setup();
    await cli.run(command.granularBuild, { root: "/project" });
    expect(adapter.calls).toEqual(["build"]);
  });

  it("requires explicit env for login/logout/down and rejects invalid inputs before mutation", async ({
    expect,
  }) => {
    const { cli, command, adapter } = setup();
    for (const entry of [command.login, command.logout, command.teardown]) {
      await expect(cli.run(entry, { root: "/project" })).rejects.toThrow(
        /--env is required/,
      );
    }
    await expect(
      cli.run(command.deploy, { root: "/project", argv: "--env prdo" }),
    ).rejects.toThrow(/Unknown environment/);
    await expect(
      cli.run(command.deploy, { root: "/project", argv: "--wrong" }),
    ).rejects.toThrow(/Unknown flag/);
    expect(adapter.calls).toEqual([]);
    expect(command.boots).toEqual([]);
    await cli.run(command.login, { root: "/project", argv: "--env staging" });
    await cli.run(command.logout, { root: "/project", argv: "--env staging" });
    expect(adapter.calls).toEqual(["login", "logout"]);
  });
});
