import { Alepha, z } from "alepha";
import { $action, AlephaServer } from "alepha/server";
import {
  tokenResponseSchema,
  userinfoResponseSchema,
} from "alepha/server/auth";
import { $swagger, ServerSwaggerProvider } from "alepha/server/swagger";
import { describe, it } from "vitest";

import {
  $issuer,
  $secure,
  AlephaSecurity,
  userAccountInfoSchema,
} from "../index.ts";

/**
 * The user schema is described to clients: an OpenAPI document, an MCP tool,
 * the devtools. Whatever it does to a value, it must stay representable as
 * JSON Schema (a transform is not).
 */
describe("userAccountInfoSchema", () => {
  it("is representable as JSON Schema, alone and inside the auth responses", ({
    expect,
  }) => {
    const user = z.toJSONSchema(userAccountInfoSchema) as unknown as {
      properties: Record<string, unknown>;
    };

    expect(Object.keys(user.properties)).toEqual(
      expect.arrayContaining(["id", "roles", "realm", "ownership"]),
    );
    expect(user.properties.ownership).toMatchObject({
      anyOf: [{ type: "string" }, { type: "boolean" }],
    });

    for (const schema of [userinfoResponseSchema, tokenResponseSchema]) {
      const response = z.toJSONSchema(schema) as unknown as {
        properties: { user: { properties: Record<string, unknown> } };
      };
      expect(Object.keys(response.properties.user.properties)).toContain(
        "ownership",
      );
    }
  });

  it("is described in the OpenAPI document of an action returning the user", async ({
    expect,
  }) => {
    const alepha = Alepha.create({
      env: { LOG_LEVEL: "error", SERVER_PORT: 0 },
    });

    class App {
      realm = $issuer({
        name: "app",
        secret: "user-schema-test-secret-0123456789",
        roles: [{ name: "member", permissions: [] }],
      });

      docs = $swagger({ info: { title: "users", version: "1" } });

      me = $action({
        method: "GET",
        path: "/me",
        schema: { response: z.object({ user: userAccountInfoSchema }) },
        use: [$secure()],
        handler: async ({ user }) => ({ user }),
      });
    }

    alepha.with(AlephaServer);
    alepha.with(AlephaSecurity);
    alepha.inject(App);
    await alepha.start();

    const document = alepha.inject(ServerSwaggerProvider).json as any;
    const path = Object.keys(document.paths).find((it) => it.endsWith("/me"))!;
    const described = JSON.stringify(document.paths[path].get.responses["200"]);

    expect(described).toContain('"ownership"');
    expect(described).toContain('"roles"');

    await alepha.stop();
  });
});
