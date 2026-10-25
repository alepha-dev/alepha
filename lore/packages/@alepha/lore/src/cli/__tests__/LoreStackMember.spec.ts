import { Alepha } from "alepha";
import {
  FileSystemProvider,
  MemoryFileSystemProvider,
  MemoryShellProvider,
  ShellProvider,
} from "alepha/system";
import { describe, it } from "vitest";

import { LoreDeployer } from "../services/LoreDeployer.ts";

/**
 * An app deployed into a stack (#Q2703): `lore({ stack })` makes the copy a
 * member of the stack environment of its own env name, creating the copy on
 * `up`, and a member builds the node target whatever its own (absent) estate.
 */
describe("an app deployed into a stack", () => {
  const create = (
    options: { member?: boolean; exists?: boolean; environment?: boolean } = {},
  ) => {
    const alepha = Alepha.create({
      env: {
        LOG_LEVEL: "error",
        LORE_API_KEY: "k",
        LORE_URL: "",
        HOME: "/nonexistent",
      },
    })
      .with({ provide: FileSystemProvider, use: MemoryFileSystemProvider })
      .with({ provide: ShellProvider, use: MemoryShellProvider });
    const deployer = alepha.inject(LoreDeployer);
    const calls: Array<{ name: string; request: unknown }> = [];
    let exists = options.exists ?? true;
    let member = options.member ?? false;
    Object.assign(deployer as unknown as Record<string, unknown>, {
      stacks: {
        listStacks: async () => ({
          items: [
            {
              id: "s1",
              name: "hello",
              environments:
                options.environment === false
                  ? []
                  : [{ id: "env-1", env: "staging", routes: [], members: [] }],
            },
          ],
        }),
        attachStackMember: async (request: unknown) => {
          calls.push({ name: "attach", request });
          member = true;
          return {};
        },
      },
      apps: {
        getApp: async () => {
          if (!exists) {
            const error = Object.assign(new Error("App not found"), {
              status: 404,
            });
            throw error;
          }
          return {
            id: "i1",
            ...(member ? { stackEnvironmentId: "env-1" } : {}),
          };
        },
        createApp: async (request: unknown) => {
          calls.push({ name: "create", request });
          exists = true;
          return { id: "i1", app: "api", env: "staging" };
        },
      },
    });
    return { deployer, calls };
  };

  it("attaches an existing copy to the stack environment of its env name", async ({
    expect,
  }) => {
    const { deployer, calls } = create();
    const instance = await deployer.memberInstance(
      7,
      "api",
      "staging",
      "hello",
      false,
    );
    expect(instance.stackEnvironmentId).toBe("env-1");
    expect(calls).toEqual([
      {
        name: "attach",
        request: {
          params: { projectId: 7, stackId: "s1", environmentId: "env-1" },
          body: { instanceId: "i1" },
        },
      },
    ]);
  });

  it("leaves a member alone", async ({ expect }) => {
    const { deployer, calls } = create({ member: true });
    await deployer.memberInstance(7, "api", "staging", "hello", false);
    expect(calls).toEqual([]);
  });

  it("refuses an environment the stack has never been deployed to, naming the command that creates it", async ({
    expect,
  }) => {
    const { deployer } = create({ environment: false });
    await expect(
      deployer.memberInstance(7, "api", "staging", "hello", true),
    ).rejects.toThrow("lore stack deploy --env staging");
  });

  it("builds the node target for a member, which has no estate of its own", async ({
    expect,
  }) => {
    const { deployer } = create();
    expect(
      await deployer.targetForInstance(7, "api", "staging", {
        stackEnvironmentId: "env-1",
      }),
    ).toBe(LoreDeployer.TARGET_FOR_RUNTIME.node);
  });
});
