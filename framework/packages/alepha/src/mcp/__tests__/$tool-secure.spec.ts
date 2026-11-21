import { $pipeline, Alepha, z } from "alepha";
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

  it("hands the handler the user its own gate published, not the enclosing request's", async () => {
    class Scoped {
      // Declares no permission: it makes no ownership decision of its own.
      seen = $tool({
        description: "What the handler is given",
        use: [$secure()],
        schema: { result: z.text() },
        handler: async ({ user }) =>
          `${user.id}:${user.ownership} atom=${alepha.store.get(currentUserAtom)?.ownership}`,
      });

      // A pipeline gated on an unrestricted permission, standing for the
      // request the tool is called from.
      enclosing = $pipeline({
        use: [$secure({ permissions: ["report:read"] })],
        handler: async () => {
          const user = alepha.store.get(currentUserAtom);
          // As `$ai` runs a tool: a fork seeded with the current user.
          return alepha.fork(
            () => alepha.inject(McpServerProvider).getTool("seen")!.execute({}),
            { [currentUserAtom.key]: user },
          );
        },
      });
    }

    const alepha = Alepha.create().with(AlephaSecurity).with(AlephaMcp);
    const scoped = alepha.inject(Scoped);
    await alepha.start();

    const result = await alepha.context.run(async () => {
      // The HTTP request the whole call arrived on, as the server hook
      // leaves it. The placeholder realm's `admin` holds `*`.
      alepha.store.set("alepha.http.request", {
        user: { id: "u1", realm: "default", roles: ["admin"] },
      } as never);
      return scoped.enclosing();
    });

    expect(result).toBe("u1:undefined atom=undefined");
  });
});
