import { Alepha } from "alepha";
import { $action, AlephaServer } from "alepha/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  $basicAuth,
  AlephaServerBasicAuth,
} from "../../src/server-basic-auth/index.ts";
import { ServerBasicAuthProvider } from "../../src/server-basic-auth/providers/ServerBasicAuthProvider.ts";

describe("Basic Authentication", () => {
  let alepha: Alepha;

  class TestApp {
    // Action with basic auth enabled via options
    protectedAction = $action({
      basicAuth: {
        username: "admin",
        password: "secret123",
      },
      handler: () => "protected success",
    });

    // Action without basic auth
    publicAction = $action({
      handler: () => "public success",
    });

    // Global basic auth for /devtools/*
    devtoolsAuth = $basicAuth({
      username: "dev",
      password: "devpass",
      paths: ["/devtools/*"],
    });

    // Multiple basic auth instances
    adminAuth = $basicAuth({
      username: "admin",
      password: "adminpass",
      paths: ["/admin/*"],
    });

    // Basic auth descriptor for custom usage
    customAuth = $basicAuth({
      username: "custom",
      password: "custompass",
    });

    customAuthAction = $action({
      handler: async (request) => {
        this.customAuth.check(request);
        return "custom auth success";
      },
    });
  }

  beforeEach(async () => {
    alepha = Alepha.create()
      .with(AlephaServer)
      .with(AlephaServerBasicAuth)
      .with(TestApp);

    await alepha.start();
  });

  afterEach(async () => {
    await alepha.stop();
  });

  describe("Action basicAuth option", () => {
    it("should allow requests with valid credentials", async () => {
      const app = alepha.inject(TestApp);

      const result = await app.protectedAction.run({
        headers: {
          authorization: `Basic ${Buffer.from("admin:secret123").toString("base64")}`,
        },
      });

      expect(result).toBe("protected success");
    });

    it("should block requests without credentials", async () => {
      const app = alepha.inject(TestApp);

      await expect(app.protectedAction.run({})).rejects.toThrow(
        "Authentication required",
      );
    });

    it("should block requests with invalid credentials", async () => {
      const app = alepha.inject(TestApp);

      await expect(
        app.protectedAction.run({
          headers: {
            authorization: `Basic ${Buffer.from("admin:wrongpass").toString("base64")}`,
          },
        }),
      ).rejects.toThrow("Invalid credentials");
    });

    it("should block requests with invalid username", async () => {
      const app = alepha.inject(TestApp);

      await expect(
        app.protectedAction.run({
          headers: {
            authorization: `Basic ${Buffer.from("wronguser:secret123").toString("base64")}`,
          },
        }),
      ).rejects.toThrow("Invalid credentials");
    });

    it("should allow public actions without authentication", async () => {
      const app = alepha.inject(TestApp);

      const result = await app.publicAction.run({});
      expect(result).toBe("public success");
    });

    it("should handle malformed authorization header", async () => {
      const app = alepha.inject(TestApp);

      await expect(
        app.protectedAction.run({
          headers: {
            authorization: "InvalidHeader",
          },
        }),
      ).rejects.toThrow("Authentication required");
    });
  });

  describe("$basicAuth descriptor", () => {
    it("should create basic auth descriptor with options", () => {
      const app = alepha.inject(TestApp);

      expect(app.devtoolsAuth).toBeDefined();
      expect(app.devtoolsAuth.name).toBe("devtoolsAuth");
      expect(app.devtoolsAuth.options.username).toBe("dev");
      expect(app.devtoolsAuth.options.password).toBe("devpass");
      expect(app.devtoolsAuth.options.paths).toEqual(["/devtools/*"]);
    });

    it("should handle custom auth check in action logic", async () => {
      const app = alepha.inject(TestApp);

      // Should succeed with valid credentials
      const result = await app.customAuthAction.run({
        headers: {
          authorization: `Basic ${Buffer.from("custom:custompass").toString("base64")}`,
        },
      });
      expect(result).toBe("custom auth success");

      // Should fail without credentials
      await expect(app.customAuthAction.run({})).rejects.toThrow(
        "Authentication required",
      );
    });
  });

  describe("Route pattern matching with getRoutes()", () => {
    it("should attach basicAuth to routes matching patterns at startup", () => {
      const provider = alepha.inject(ServerBasicAuthProvider);
      const app = alepha.inject(TestApp);

      // Verify that auth was registered
      expect(provider.registeredAuths.length).toBeGreaterThanOrEqual(2);
      expect(
        provider.registeredAuths.find((a) => a.username === "dev"),
      ).toBeDefined();
      expect(
        provider.registeredAuths.find((a) => a.username === "admin"),
      ).toBeDefined();
    });

    it("should register multiple auth instances", () => {
      const provider = alepha.inject(ServerBasicAuthProvider);
      const app = alepha.inject(TestApp);

      expect(provider.registeredAuths.length).toBeGreaterThanOrEqual(2);
      expect(
        provider.registeredAuths.find((a) => a.username === "dev"),
      ).toBeDefined();
      expect(
        provider.registeredAuths.find((a) => a.username === "admin"),
      ).toBeDefined();
    });
  });

  describe("Multiple basic auth instances", () => {
    it("should support multiple auth instances with different credentials", () => {
      const app = alepha.inject(TestApp);

      expect(app.devtoolsAuth.options.username).toBe("dev");
      expect(app.adminAuth.options.username).toBe("admin");
    });

    it("should register multiple auth instances", () => {
      const app = alepha.inject(TestApp);
      const provider = alepha.inject(ServerBasicAuthProvider);

      expect(provider.registeredAuths.length).toBeGreaterThanOrEqual(2);
      expect(
        provider.registeredAuths.find((a) => a.username === "dev"),
      ).toBeDefined();
      expect(
        provider.registeredAuths.find((a) => a.username === "admin"),
      ).toBeDefined();
    });
  });

  describe("Integration", () => {
    it("should integrate basic auth with action hooks", async () => {
      const app = alepha.inject(TestApp);

      // Should work with valid credentials
      const result = await app.protectedAction.run({
        headers: {
          authorization: `Basic ${Buffer.from("admin:secret123").toString("base64")}`,
        },
      });
      expect(result).toBe("protected success");

      // Should fail without credentials
      await expect(app.protectedAction.run({})).rejects.toThrow(
        "Authentication required",
      );
    });

    it("should work with case-sensitive credentials", async () => {
      const app = alepha.inject(TestApp);

      // Correct case should work
      const result = await app.protectedAction.run({
        headers: {
          authorization: `Basic ${Buffer.from("admin:secret123").toString("base64")}`,
        },
      });
      expect(result).toBe("protected success");

      // Wrong case should fail
      await expect(
        app.protectedAction.run({
          headers: {
            authorization: `Basic ${Buffer.from("ADMIN:secret123").toString("base64")}`,
          },
        }),
      ).rejects.toThrow("Invalid credentials");
    });
  });

  describe("Edge cases", () => {
    it("should handle credentials with colon in password", async () => {
      class EdgeCaseApp {
        colonPasswordAction = $action({
          basicAuth: {
            username: "user",
            password: "pass:word:123",
          },
          handler: () => "success",
        });
      }

      const edgeAlepha = Alepha.create()
        .with(AlephaServer)
        .with(AlephaServerBasicAuth)
        .with(EdgeCaseApp);

      await edgeAlepha.start();

      const app = edgeAlepha.inject(EdgeCaseApp);

      const result = await app.colonPasswordAction.run({
        headers: {
          authorization: `Basic ${Buffer.from("user:pass:word:123").toString("base64")}`,
        },
      });
      expect(result).toBe("success");

      await edgeAlepha.stop();
    });

    it("should handle empty password", async () => {
      class EmptyPasswordApp {
        emptyPasswordAction = $action({
          basicAuth: {
            username: "user",
            password: "",
          },
          handler: () => "success",
        });
      }

      const emptyAlepha = Alepha.create()
        .with(AlephaServer)
        .with(AlephaServerBasicAuth)
        .with(EmptyPasswordApp);

      await emptyAlepha.start();

      const app = emptyAlepha.inject(EmptyPasswordApp);

      const result = await app.emptyPasswordAction.run({
        headers: {
          authorization: `Basic ${Buffer.from("user:").toString("base64")}`,
        },
      });
      expect(result).toBe("success");

      await emptyAlepha.stop();
    });

    it("should handle special characters in credentials", async () => {
      class SpecialCharsApp {
        specialCharsAction = $action({
          basicAuth: {
            username: "user@domain.com",
            password: "p@$$w0rd!#$%",
          },
          handler: () => "success",
        });
      }

      const specialAlepha = Alepha.create()
        .with(AlephaServer)
        .with(AlephaServerBasicAuth)
        .with(SpecialCharsApp);

      await specialAlepha.start();

      const app = specialAlepha.inject(SpecialCharsApp);

      const result = await app.specialCharsAction.run({
        headers: {
          authorization: `Basic ${Buffer.from("user@domain.com:p@$$w0rd!#$%").toString("base64")}`,
        },
      });
      expect(result).toBe("success");

      await specialAlepha.stop();
    });
  });
});
