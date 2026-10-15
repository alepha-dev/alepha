import { Alepha, AlephaError } from "alepha";
import {
  AlephaSecurity,
  InvalidPermissionError,
  InvalidTokenError,
  RealmNotFoundError,
  SecurityProvider,
} from "alepha/security";
import {
  ForbiddenError,
  HttpError,
  ServerProvider,
  UnauthorizedError,
} from "alepha/server";
import { describe, expect, it } from "vitest";

import { $auth } from "../primitives/$auth.ts";
import { ServerAuthProvider } from "../providers/ServerAuthProvider.ts";

/**
 * Security errors answer with their own status (#Q2658): a bad token 401, a
 * bad permission 403, a missing realm 500. `POST /_auth/refresh` answers 401
 * for a dead refresh token and lets any other failure through unchanged,
 * instead of a 403 for everything.
 */
describe("security error statuses", () => {
  it("InvalidTokenError is a 401", () => {
    const error = new InvalidTokenError("Token expired");
    expect(error).toBeInstanceOf(UnauthorizedError);
    expect(error.status).toBe(401);
  });

  it("InvalidPermissionError is a 403", () => {
    const error = new InvalidPermissionError("bad name");
    expect(error).toBeInstanceOf(ForbiddenError);
    expect(error.status).toBe(403);
  });

  it("RealmNotFoundError is a configuration error, not an HTTP one", () => {
    const alepha = Alepha.create().with(AlephaSecurity);
    const security = alepha.inject(SecurityProvider);

    const error = (() => {
      try {
        security.getRealm("nowhere");
      } catch (caught) {
        return caught;
      }
    })();

    expect(error).toBeInstanceOf(RealmNotFoundError);
    expect(error).toBeInstanceOf(AlephaError);
    expect(error).not.toBeInstanceOf(HttpError);
  });
});

describe("POST /_auth/refresh", () => {
  const issuerFailingWith = (failure: () => Error) =>
    ({
      name: "test-realm",
      createToken: async () => ({ access_token: "a", expires_in: 3600 }),
      refreshToken: async () => {
        throw failure();
      },
      options: {},
    }) as any;

  const boot = async (failure: () => Error) => {
    class App {
      credentials = $auth({
        name: "credentials",
        issuer: issuerFailingWith(failure),
        credentials: { account: async () => undefined },
      });
    }
    const alepha = Alepha.create().with(App).with(ServerAuthProvider);
    await alepha.start();
    return alepha.inject(ServerProvider).hostname;
  };

  const refresh = (hostname: string) =>
    fetch(`${hostname}/_auth/refresh?provider=credentials`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ refresh_token: "r", access_token: "a" }),
    });

  it("answers 401 for an expired or revoked refresh token", async () => {
    const hostname = await boot(
      () => new UnauthorizedError("Invalid refresh token"),
    );
    expect((await refresh(hostname)).status).toBe(401);
  });

  it("lets a failure that is not about the token through as a 500", async () => {
    const hostname = await boot(() => new AlephaError("database is down"));
    expect((await refresh(hostname)).status).toBe(500);
  });
});
