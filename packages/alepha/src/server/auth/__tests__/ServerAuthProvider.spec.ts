import { Alepha } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { SecurityError, type UserAccount } from "alepha/security";
import { describe, expect, it } from "vitest";
import { $auth } from "../primitives/$auth.ts";
import { ServerAuthProvider } from "../providers/ServerAuthProvider.ts";

// ─────────────────────────────────────────────────────────────────────────────
// Test subclass to expose protected methods
// ─────────────────────────────────────────────────────────────────────────────

class TestServerAuthProvider extends ServerAuthProvider {
  public testProvider(opts: string | { provider: string; realm?: string }) {
    return this.provider(opts);
  }

  public testRefreshTokens(tokens: any) {
    return this.refreshTokens(tokens);
  }

  public testGetAuthenticationProviders(filters: { realmName?: string } = {}) {
    return this.getAuthenticationProviders(filters);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Mock issuer for credentials-based auth
// ─────────────────────────────────────────────────────────────────────────────

const mockIssuer = {
  name: "test-realm",
  createToken: async (user: UserAccount) => ({
    access_token: `access-${user.id}`,
    refresh_token: `refresh-${user.id}`,
    expires_in: 3600,
  }),
  refreshToken: async (refreshToken: string) => ({
    tokens: {
      access_token: "new-access-token",
      refresh_token: "new-refresh-token",
      expires_in: 3600,
    },
  }),
  options: {},
} as any;

// ─────────────────────────────────────────────────────────────────────────────
// Test App with auth primitives
// ─────────────────────────────────────────────────────────────────────────────

class TestAuthApp {
  credentials = $auth({
    name: "credentials",
    issuer: mockIssuer,
    credentials: {
      account: async ({ username, password }) => {
        if (username === "admin" && password === "secret") {
          return {
            id: "user-1",
            name: "Admin",
            email: "admin@test.com",
          } as UserAccount;
        }
        return undefined;
      },
    },
  });

  google = $auth({
    name: "google",
    disabled: true,
    oidc: {
      issuer: "https://accounts.google.com",
      clientId: "fake-client-id",
      clientSecret: "fake-secret",
    },
  });

  github = $auth({
    name: "github",
    issuer: mockIssuer,
    oauth: {
      clientId: "gh-client",
      clientSecret: "gh-secret",
      authorization: "https://github.com/login/oauth/authorize",
      token: "https://github.com/login/oauth/access_token",
      userinfo: async () => ({
        sub: "gh-123",
        name: "Test User",
        email: "test@github.com",
      }),
    },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("ServerAuthProvider", () => {
  const createApp = () => {
    const alepha = Alepha.create();
    alepha.with(TestAuthApp);
    alepha.with(TestServerAuthProvider);

    const auth = alepha.inject(TestServerAuthProvider);
    const time = alepha.inject(DateTimeProvider);

    return { alepha, auth, time };
  };

  describe("getAuthenticationProviders", () => {
    it("should return enabled providers with their types", () => {
      const { auth } = createApp();

      const providers = auth.testGetAuthenticationProviders();

      // google is disabled, so should not appear
      expect(providers).toHaveLength(2);

      const credentialsProv = providers.find((p) => p.name === "credentials");
      expect(credentialsProv?.type).toBe("CREDENTIALS");

      const githubProv = providers.find((p) => p.name === "github");
      expect(githubProv?.type).toBe("OAUTH2");
    });

    it("should filter by realm", () => {
      const { auth } = createApp();

      const providers = auth.testGetAuthenticationProviders({
        realmName: "test-realm",
      });

      // Both credentials and github have mockIssuer with name "test-realm"
      expect(providers.length).toBeGreaterThan(0);
      for (const p of providers) {
        expect(["credentials", "github"]).toContain(p.name);
      }
    });

    it("should return empty for unknown realm", () => {
      const { auth } = createApp();

      const providers = auth.testGetAuthenticationProviders({
        realmName: "nonexistent",
      });
      expect(providers).toHaveLength(0);
    });
  });

  describe("provider lookup", () => {
    it("should find provider by name", () => {
      const { auth } = createApp();

      const provider = auth.testProvider("credentials");
      expect(provider.name).toBe("credentials");
    });

    it("should find provider by name and realm", () => {
      const { auth } = createApp();

      const provider = auth.testProvider({
        provider: "credentials",
        realm: "test-realm",
      });
      expect(provider.name).toBe("credentials");
    });

    it("should throw SecurityError for unknown provider", () => {
      const { auth } = createApp();

      expect(() => auth.testProvider("unknown")).toThrow(SecurityError);
    });

    it("should throw SecurityError for provider with wrong realm", () => {
      const { auth } = createApp();

      expect(() =>
        auth.testProvider({ provider: "credentials", realm: "wrong-realm" }),
      ).toThrow(SecurityError);
    });

    it("should not find disabled providers", () => {
      const { auth } = createApp();

      expect(() => auth.testProvider("google")).toThrow(SecurityError);
    });
  });

  describe("refreshTokens", () => {
    it("should return tokens when not expired", () => {
      const { auth, time } = createApp();
      const now = time.now().unix();

      const tokens = {
        provider: "credentials",
        access_token: "access",
        refresh_token: "refresh",
        expires_in: 3600,
        issued_at: now,
      };

      return auth.testRefreshTokens(tokens).then((result) => {
        expect(result).toEqual(tokens);
      });
    });

    it("should refresh expired tokens with refresh_token", async () => {
      const { auth, time } = createApp();
      const now = time.now().unix();

      const tokens = {
        provider: "credentials",
        access_token: "old-access",
        refresh_token: "refresh",
        expires_in: 3600,
        issued_at: now - 4000, // expired
      };

      const result = await auth.testRefreshTokens(tokens);
      expect(result?.access_token).toBe("new-access-token");
    });

    it("should return undefined for expired tokens without refresh_token", async () => {
      const { auth, time } = createApp();
      const now = time.now().unix();

      const tokens = {
        provider: "credentials",
        access_token: "old-access",
        expires_in: 3600,
        issued_at: now - 4000, // expired, no refresh_token
      };

      const result = await auth.testRefreshTokens(tokens);
      expect(result).toBeUndefined();
    });

    it("should return undefined when no issued_at and has access_token", async () => {
      const { auth } = createApp();

      const tokens = {
        provider: "credentials",
        access_token: "access",
      };

      const result = await auth.testRefreshTokens(tokens);
      expect(result).toBeUndefined();
    });
  });

  describe("identities", () => {
    it("should return only enabled auth primitives", () => {
      const { auth } = createApp();

      const identities = auth.identities;

      // google is disabled
      expect(identities.some((i) => i.name === "credentials")).toBe(true);
      expect(identities.some((i) => i.name === "github")).toBe(true);
      expect(identities.some((i) => i.name === "google")).toBe(false);
    });
  });
});
