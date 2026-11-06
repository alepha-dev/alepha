import { Alepha } from "alepha";
import {
  CliProvider,
  ConsoleOutputProvider,
  MemoryOutputProvider,
} from "alepha/command";
import {
  FileSystemProvider,
  MemoryFileSystemProvider,
  MemoryShellProvider,
  ShellProvider,
} from "alepha/system";
import { describe, it } from "vitest";

import { ProjectCommand } from "../commands/ProjectCommand.ts";
import { LoreProjectResolver } from "../services/LoreProjectResolver.ts";

/**
 * `lore project capability list | enable | disable` (#Q3141). The write takes
 * a capability's options whole, so `enable --option` merges into what is on
 * now: enabling `track` must not turn `deploy` off.
 */
describe("lore project capability", () => {
  const create = () => {
    const alepha = Alepha.create({
      env: {
        LOG_LEVEL: "error",
        LORE_API_KEY: "k",
        LORE_URL: "https://lore.test",
        LORE_PROJECT: "hello",
        HOME: "/nonexistent",
      },
    })
      .with({ provide: FileSystemProvider, use: MemoryFileSystemProvider })
      .with({ provide: ShellProvider, use: MemoryShellProvider })
      .with({ provide: ConsoleOutputProvider, use: MemoryOutputProvider });
    const printed = alepha.inject(MemoryOutputProvider).lines;
    const calls: Array<{ name: string; request: unknown }> = [];
    const command = alepha.inject(ProjectCommand);
    Object.assign(
      alepha.inject(LoreProjectResolver) as unknown as Record<string, unknown>,
      { projects: { getProjectBySlug: async () => ({ id: 7 }) } },
    );
    Object.assign(command as unknown as Record<string, unknown>, {
      capabilityApi: {
        listCapabilities: async () => ({
          items: [
            {
              key: "apps",
              name: "Deploy and watch apps",
              enabled: true,
              options: [
                { key: "track", enabled: false },
                { key: "deploy", enabled: true },
              ],
            },
            { key: "support", name: "Support", enabled: false, options: [] },
          ],
        }),
        setCapability: async (request: unknown) => {
          calls.push({ name: "set", request });
          return { slug: "hello" };
        },
      },
    });
    const run = async (
      sub: "capabilityList" | "capabilityEnable" | "capabilityDisable",
      argv: string,
    ) => {
      await alepha.inject(CliProvider).run(command[sub] as never, { argv });
    };
    return { run, printed, calls };
  };

  it("lists each capability with its options", async ({ expect }) => {
    const { run, printed } = create();
    await run("capabilityList", "");
    const out = printed.join("\n");
    expect(out).toMatch(/\[x\] apps\s+Deploy and watch apps/);
    expect(out).toContain("off track");
    expect(out).toContain("on  deploy");
    expect(out).toMatch(/\[ \] support/);
  });

  it("enables an option merged into the current ones, so nothing else flips", async ({
    expect,
  }) => {
    const { run, calls } = create();
    await run("capabilityEnable", "apps --option track");
    expect(calls).toEqual([
      {
        name: "set",
        request: {
          params: { projectId: 7, key: "apps" },
          body: { enabled: true, options: { track: true, deploy: true } },
        },
      },
    ]);
  });

  it("turns an option off with name=false, and refuses an unknown one or key", async ({
    expect,
  }) => {
    const { run, calls } = create();
    await run("capabilityEnable", "apps --option deploy=false --option track");
    expect(
      (calls[0].request as { body: { options: object } }).body.options,
    ).toEqual({ track: true, deploy: false });
    await expect(run("capabilityEnable", "apps --option nope")).rejects.toThrow(
      "apps has no option nope. Its options: track, deploy.",
    );
    await expect(run("capabilityEnable", "nope")).rejects.toThrow(
      "No capability called nope. There are: apps, support.",
    );
  });

  it("disables a capability", async ({ expect }) => {
    const { run, calls } = create();
    await run("capabilityDisable", "support");
    expect(calls).toEqual([
      {
        name: "set",
        request: {
          params: { projectId: 7, key: "support" },
          body: { enabled: false },
        },
      },
    ]);
  });
});
