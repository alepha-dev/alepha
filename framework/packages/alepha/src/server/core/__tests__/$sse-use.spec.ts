import { Alepha, z } from "alepha";
import {
  $secure,
  AlephaSecurity,
  SecurityProvider,
  type UserAccountToken,
} from "alepha/security";
import { describe, it } from "vitest";

import { $sse } from "../index.ts";

/**
 * Resolves the caller from an `x-user` header, so the HTTP path has an
 * identity without minting tokens.
 */
class HeaderSecurityProvider extends SecurityProvider {
  public override async resolveUserFromServerRequest(request: {
    headers: Record<string, string | undefined>;
  }): Promise<UserAccountToken | undefined> {
    const id = request.headers["x-user"];
    return id ? { id, realm: "default", roles: ["member"] } : undefined;
  }
}

class Api {
  whoami = $sse({
    path: "/whoami",
    use: [$secure()],
    schema: { data: z.object({ id: z.text() }) },
    // `user` is typed non-optional by the middleware, as on `$action`:
    // reading `user.id` with no guard is the type assertion.
    handler: async ({ emit, user }) => {
      emit({ id: user.id });
    },
  });

  admins = $sse({
    path: "/admins",
    use: [$secure({ roles: ["admin"] })],
    schema: { data: z.object({ ok: z.boolean() }) },
    handler: async ({ emit }) => {
      emit({ ok: true });
    },
  });
}

describe("$sse use", () => {
  const setup = async () => {
    const alepha = Alepha.create()
      .with({ provide: SecurityProvider, use: HeaderSecurityProvider })
      .with(AlephaSecurity);
    const api = alepha.inject(Api);
    await alepha.start();
    return { alepha, api };
  };

  it("hands the handler the user $secure resolved, over HTTP", async ({
    expect,
  }) => {
    const { api } = await setup();
    const res = await api.whoami.fetch({ headers: { "x-user": "u7" } });
    expect(res.status).toBe(200);
    const events = [];
    for await (const event of res) {
      events.push(event);
    }
    expect(events).toEqual([{ id: "u7" }]);
  });

  it("refuses an anonymous caller with 401 before the stream opens", async ({
    expect,
  }) => {
    const { api } = await setup();
    const res = await api.whoami.fetch();
    expect(res.status).toBe(401);
  });

  it("refuses a caller without the role with 403", async ({ expect }) => {
    const { api } = await setup();
    const res = await api.admins.fetch({ headers: { "x-user": "u7" } });
    expect(res.status).toBe(403);
  });

  it("runs the middlewares on run() too, failing the stream", async ({
    expect,
  }) => {
    const { api } = await setup();
    await expect(
      (async () => {
        for await (const _ of api.whoami.run()) {
          // unreachable: the middleware refuses first
        }
      })(),
    ).rejects.toThrow("Authentication required");
  });
});
