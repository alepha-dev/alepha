import { mkdirSync } from "node:fs";

import { Alepha } from "alepha";
import { AlephaSecurity, SecurityProvider } from "alepha/security";
import { AlephaServer, ServerProvider } from "alepha/server";
import { beforeAll, describe, expect, it } from "vitest";

import { AlephaDevtools } from "../index.ts";

// Same reason as DevToolsProvider.spec.ts: outside production the module serves
// its built UI from the gitignored `assets/ui`, and ServerStaticProvider fails
// to boot on a missing root.
beforeAll(() => {
  mkdirSync(new URL("../../assets/ui", import.meta.url), { recursive: true });
});

/**
 * Stands in for a real resolver. Which channel carried the credential is
 * `SecurityProvider`'s business, not this route's, so the fake resolves off a
 * header and the spec stays about what the endpoint reports.
 *
 * The resolved user carries a `token`, because that is what a real session
 * resolution produces and it is precisely the field that must not be served.
 */
class HeaderSecurityProvider extends SecurityProvider {
  public override async resolveUserFromServerRequest(
    request: any,
  ): Promise<any> {
    if (request.headers?.authorization !== "Bearer session") {
      return undefined;
    }
    return {
      id: "u1",
      name: "Alice",
      email: "alice@example.com",
      roles: ["admin"],
      realm: "main",
      token: "super-secret-access-token",
    };
  }
}

const boot = async (secured: boolean) => {
  const alepha = Alepha.create({ env: { SERVER_PORT: 0, LOG_LEVEL: "error" } })
    .with(AlephaServer)
    .with(AlephaDevtools);

  if (secured) {
    alepha
      .with({ provide: SecurityProvider, use: HeaderSecurityProvider })
      .with(AlephaSecurity);
  }

  await alepha.start();
  return alepha;
};

const getSession = async (alepha: Alepha, headers: HeadersInit = {}) => {
  const res = await fetch(
    `${alepha.inject(ServerProvider).hostname}/__devtools/api/session`,
    { headers },
  );
  return { status: res.status, body: await res.json() };
};

describe("DevToolsProvider: GET /__devtools/api/session", () => {
  it("reports the user the application resolved for the request", async () => {
    const alepha = await boot(true);

    const { status, body } = await getSession(alepha, {
      authorization: "Bearer session",
    });

    expect(status).toBe(200);
    expect(body.user).toMatchObject({
      id: "u1",
      name: "Alice",
      email: "alice@example.com",
      roles: ["admin"],
      realm: "main",
    });
  });

  it("never serves the access token", async () => {
    const alepha = await boot(true);

    const { body } = await getSession(alepha, {
      authorization: "Bearer session",
    });

    // The response schema is what serializes, so declaring the fields is also
    // what keeps the credential out of the browser. Devtools has no use for it
    // now that Try It rides the session cookie instead of replaying a token.
    expect(body.user).not.toHaveProperty("token");
    expect(JSON.stringify(body)).not.toContain("super-secret-access-token");
  });

  it("answers with no user when nobody is signed in", async () => {
    const alepha = await boot(true);

    const { status, body } = await getSession(alepha);

    expect(status).toBe(200);
    expect(body.user).toBeUndefined();
  });

  it("answers with no user when the application has no security module", async () => {
    const alepha = await boot(false);

    const { status, body } = await getSession(alepha, {
      authorization: "Bearer session",
    });

    // An unsecured application is not an error state for the chip: "nobody" is
    // the correct and only available answer.
    expect(status).toBe(200);
    expect(body.user).toBeUndefined();
  });
});
