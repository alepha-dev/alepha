import { Alepha } from "alepha";
import { CliProvider } from "alepha/command";
import { HttpError } from "alepha/server";
import {
  FileSystemProvider,
  MemoryFileSystemProvider,
  MemoryShellProvider,
  ShellProvider,
} from "alepha/system";
import { afterEach, describe, expect, it } from "vitest";

import { SecretsCommand } from "../commands/SecretsCommand.ts";

/**
 * `lore secrets`: the copy's secret store, from a terminal or a CI job.
 *
 * The API is faked at the `$client` seam, the same way `AppsCommand.spec.ts`
 * does it, so what is asserted is exactly what would have been sent.
 */
describe("lore secrets", () => {
  const create = (
    options: { instances?: string[]; refused?: Record<string, string> } = {},
  ) => {
    const alepha = Alepha.create({
      env: {
        LOG_LEVEL: "error",
        LORE_API_KEY: "k",
        LORE_URL: "",
        LORE_PROJECT: "club",
        HOME: "/nonexistent",
      },
    })
      .with({ provide: FileSystemProvider, use: MemoryFileSystemProvider })
      .with({ provide: ShellProvider, use: MemoryShellProvider });

    const fs = alepha.inject(MemoryFileSystemProvider);
    const cli = alepha.inject(CliProvider);
    const command = alepha.inject(SecretsCommand);
    const instances = options.instances ?? ["staging"];
    const refused = options.refused ?? {};

    const sent: Array<{ instanceId: string; key: string; value: string }> = [];
    const removed: string[] = [];
    const printed: string[] = [];

    Object.assign(command as unknown as Record<string, unknown>, {
      apps: {
        getApp: async ({ params }: { params: { env: string } }) => {
          if (!instances.includes(params.env)) {
            throw new HttpError({ status: 404, message: "App not found" });
          }
          return { id: `inst-${params.env}` };
        },
      },
      secrets: {
        setAppSecret: async ({
          params,
          body,
        }: {
          params: { instanceId: string };
          body: { key: string; value: string };
        }) => {
          if (refused[body.key]) {
            throw new HttpError({ status: 400, message: refused[body.key] });
          }
          sent.push({ instanceId: params.instanceId, ...body });
          return { id: "s", key: body.key };
        },
        listAppSecrets: async () => ({
          items: [{ id: "1", key: "APP_SECRET", valuePrefix: "abcd" }],
        }),
        deleteAppSecret: async ({ params }: { params: { key: string } }) => {
          removed.push(params.key);
          return { ok: true };
        },
      },
      projects: {
        resolve: async () => 45,
        resolveApp: async (flag?: string) => flag || "platform",
      },
      log: {
        info: (message: string) => printed.push(message),
        warn: () => {},
        error: () => {},
        debug: () => {},
        trace: () => {},
      },
    });

    return { fs, cli, command, sent, removed, printed };
  };

  afterEach(() => {
    delete process.env.LORE_SPEC_SECRET;
  });

  it("sets one KEY=VALUE on the copy --env names", async () => {
    const { cli, command, sent } = create();

    await cli.run(command.set, {
      root: "/project",
      argv: "STRIPE_SECRET_KEY=sk_test_1 --env staging",
    });

    expect(sent).toEqual([
      {
        instanceId: "inst-staging",
        key: "STRIPE_SECRET_KEY",
        value: "sk_test_1",
      },
    ]);
  });

  it("keeps everything after the first = as the value", async () => {
    const { cli, command, sent } = create();

    await cli.run(command.set, {
      root: "/project",
      argv: "DATABASE_TOKEN=a=b=c --env staging",
    });

    expect(sent[0]!.value).toBe("a=b=c");
  });

  it("reads a bare KEY from the environment, so the value stays out of shell history", async () => {
    const { cli, command, sent } = create();
    process.env.LORE_SPEC_SECRET = "from-env";

    await cli.run(command.set, {
      root: "/project",
      argv: "LORE_SPEC_SECRET --env staging",
    });

    expect(sent[0]).toMatchObject({
      key: "LORE_SPEC_SECRET",
      value: "from-env",
    });
  });

  it("refuses a bare KEY the environment does not have", async () => {
    const { cli, command, sent } = create();

    await expect(
      cli.run(command.set, {
        root: "/project",
        argv: "LORE_SPEC_SECRET --env staging",
      }),
    ).rejects.toThrow(/not set in this environment/);
    expect(sent).toEqual([]);
  });

  it("sets every key of a dotenv file, and leaves SIGIL_KEY and empty values alone", async () => {
    const { fs, cli, command, sent, printed } = create();
    await fs.writeFile(
      "/project/.env.staging",
      [
        "APP_SECRET=one",
        "# a comment",
        'CLUB_DEPLOY_ENV=\'{"EMAIL_FROM":"a@b.c"}\'',
        "SIGIL_KEY=sg_club_old",
        "TURNSTILE_SITE_KEY=",
      ].join("\n"),
    );

    await cli.run(command.set, {
      root: "/project",
      argv: "--file .env.staging --env staging",
    });

    expect(sent.map((it) => [it.key, it.value])).toEqual([
      ["APP_SECRET", "one"],
      ["CLUB_DEPLOY_ENV", '{"EMAIL_FROM":"a@b.c"}'],
    ]);
    expect(printed.some((line) => line.includes("SIGIL_KEY"))).toBe(true);
    expect(printed.some((line) => line.includes("TURNSTILE_SITE_KEY"))).toBe(
      true,
    );
  });

  it("never prints a value", async () => {
    const { fs, cli, command, printed } = create();
    await fs.writeFile("/project/.env.staging", "APP_SECRET=very-secret");

    await cli.run(command.set, {
      root: "/project",
      argv: "--file .env.staging --env staging",
    });

    expect(printed.join("\n")).not.toContain("very-secret");
  });

  it("wants one secret or one file, not both and not neither", async () => {
    const { cli, command, sent } = create();

    await expect(
      cli.run(command.set, { root: "/project", argv: "--env staging" }),
    ).rejects.toThrow(/Not both, and not neither/);
    await expect(
      cli.run(command.set, {
        root: "/project",
        argv: "A=1 --file .env.staging --env staging",
      }),
    ).rejects.toThrow(/Not both, and not neither/);
    expect(sent).toEqual([]);
  });

  it("never guesses the copy: --env is required", async () => {
    const { cli, command, sent } = create();

    await expect(
      cli.run(command.set, { root: "/project", argv: "A=1" }),
    ).rejects.toThrow();
    expect(sent).toEqual([]);
  });

  it("refuses a copy that does not exist, and writes nothing", async () => {
    const { cli, command, sent } = create({ instances: ["production"] });

    await expect(
      cli.run(command.set, { root: "/project", argv: "A=1 --env staging" }),
    ).rejects.toThrow(/platform\/staging is not a deployed copy/);
    expect(sent).toEqual([]);
  });

  it("sets the rest of a file when Lore refuses one key, then fails naming it", async () => {
    const { fs, cli, command, sent } = create({
      refused: { DATABASE_URL: "DATABASE_URL is reserved" },
    });
    await fs.writeFile(
      "/project/.env.staging",
      "DATABASE_URL=sqlite://x\nAPP_SECRET=one",
    );

    await expect(
      cli.run(command.set, {
        root: "/project",
        argv: "--file .env.staging --env staging",
      }),
    ).rejects.toThrow(/DATABASE_URL: DATABASE_URL is reserved/);
    expect(sent.map((it) => it.key)).toEqual(["APP_SECRET"]);
  });

  it("lists keys with Lore's masked prefix only", async () => {
    const { cli, command, printed } = create();

    await cli.run(command.list, { root: "/project", argv: "--env staging" });

    expect(printed).toEqual(["APP_SECRET  abcd…"]);
  });

  it("removes one key", async () => {
    const { cli, command, removed } = create();

    await cli.run(command.unset, {
      root: "/project",
      argv: "APP_SECRET --env staging",
    });

    expect(removed).toEqual(["APP_SECRET"]);
  });
});
