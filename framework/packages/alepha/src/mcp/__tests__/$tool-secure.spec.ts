import { Alepha, z } from "alepha";
import { $secure, AlephaSecurity, currentUserAtom } from "alepha/security";
import { ForbiddenError, UnauthorizedError } from "alepha/server";
import { describe, expect, it } from "vitest";

import { $tool, AlephaMcp, McpServerProvider } from "../index.ts";

/**
 * A tool requires a user, a role or a permission through `use: [$secure()]`,
 * like an action, and its handler then gets a typed, non-optional `user`
 * (#Q2658).
 */
describe("$tool with use: [$secure()]", () => {
  class Tools {
    whoami = $tool({
      description: "The caller's id",
      use: [$secure({ roles: ["admin"] })],
      schema: { result: z.text() },
      handler: async ({ user }) => user.id,
    });
  }

  const boot = async () => {
    const alepha = Alepha.create().with(AlephaSecurity).with(AlephaMcp);
    alepha.with(Tools);
    await alepha.start();
    const tool = alepha.inject(McpServerProvider).getTool("whoami")!;
    return { alepha, tool };
  };

  it("refuses an anonymous call with UnauthorizedError", async () => {
    const { alepha, tool } = await boot();

    await expect(alepha.context.run(() => tool.execute({}))).rejects.toThrow(
      UnauthorizedError,
    );
  });

  it("refuses a user without the role with ForbiddenError", async () => {
    const { alepha, tool } = await boot();

    await expect(
      alepha.context.run(() => {
        alepha.store.set(currentUserAtom, { id: "u-1", roles: ["user"] });
        return tool.execute({});
      }),
    ).rejects.toThrow(ForbiddenError);
  });

  it("hands the handler the user $secure resolved", async () => {
    const { alepha, tool } = await boot();

    const result = await alepha.context.run(() => {
      alepha.store.set(currentUserAtom, { id: "u-2", roles: ["admin"] });
      return tool.execute({});
    });

    expect(result).toBe("u-2");
  });
});
