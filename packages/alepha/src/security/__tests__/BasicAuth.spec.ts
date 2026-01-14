import { Alepha } from "alepha";
import { $action, AlephaServer } from "alepha/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  $basicAuth,
  AlephaSecurity,
  ServerBasicAuthProvider,
} from "../index.ts";

describe("Basic Authentication", () => {
  let alepha: Alepha;

  class TestApp {
    // Action with basic auth enabled via options
    protectedAction = $action({
      secure: {
        basic: {
          username: "admin",
          password: "secret123",
        },
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

    // Basic auth primitive for custom usage
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
      .with(AlephaSecurity)
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

  describe("$basicAuth primitive", () => {
    it("should create basic auth primitive with options", () => {
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
          secure: {
            basic: {
              username: "user",
              password: "pass:word:123",
            },
          },
          handler: () => "success",
        });
      }

      const edgeAlepha = Alepha.create()
        .with(AlephaServer)
        .with(AlephaSecurity)
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
          secure: {
            basic: {
              username: "user",
              password: "",
            },
          },
          handler: () => "success",
        });
      }

      const emptyAlepha = Alepha.create()
        .with(AlephaServer)
        .with(AlephaSecurity)
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
          secure: {
            basic: {
              username: "user@domain.com",
              password: "p@$$w0rd!#$%",
            },
          },
          handler: () => "success",
        });
      }

      const specialAlepha = Alepha.create()
        .with(AlephaServer)
        .with(AlephaSecurity)
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

    it("should handle unicode characters (UTF-8) in credentials - valid", async () => {
      class UnicodeApp {
        unicodeAction = $action({
          secure: {
            basic: {
              username: "用户名",
              password: "密码🔐émoji",
            },
          },
          handler: () => "success",
        });
      }

      const unicodeAlepha = Alepha.create()
        .with(AlephaServer)
        .with(AlephaSecurity)
        .with(UnicodeApp);

      await unicodeAlepha.start();

      const app = unicodeAlepha.inject(UnicodeApp);

      const result = await app.unicodeAction.run({
        headers: {
          authorization: `Basic ${Buffer.from("用户名:密码🔐émoji").toString("base64")}`,
        },
      });
      expect(result).toBe("success");

      await unicodeAlepha.stop();
    });

    it("should handle unicode characters (UTF-8) in credentials - invalid", async () => {
      class UnicodeApp {
        unicodeAction = $action({
          secure: {
            basic: {
              username: "用户名",
              password: "密码🔐émoji",
            },
          },
          handler: () => "success",
        });
      }

      const unicodeAlepha = Alepha.create()
        .with(AlephaServer)
        .with(AlephaSecurity)
        .with(UnicodeApp);

      await unicodeAlepha.start();

      const app = unicodeAlepha.inject(UnicodeApp);

      // Should fail with wrong unicode password
      await expect(
        app.unicodeAction.run({
          headers: {
            authorization: `Basic ${Buffer.from("用户名:wrongpassword").toString("base64")}`,
          },
        }),
      ).rejects.toThrow("Invalid credentials");

      await unicodeAlepha.stop();
    });

    it("should handle very long credentials", async () => {
      const longUsername = "a".repeat(1000);
      const longPassword = "b".repeat(5000);

      class LongCredsApp {
        longCredsAction = $action({
          secure: {
            basic: {
              username: longUsername,
              password: longPassword,
            },
          },
          handler: () => "success",
        });
      }

      const longAlepha = Alepha.create()
        .with(AlephaServer)
        .with(AlephaSecurity)
        .with(LongCredsApp);

      await longAlepha.start();

      const app = longAlepha.inject(LongCredsApp);

      const result = await app.longCredsAction.run({
        headers: {
          authorization: `Basic ${Buffer.from(`${longUsername}:${longPassword}`).toString("base64")}`,
        },
      });
      expect(result).toBe("success");

      await longAlepha.stop();
    });

    it("should handle empty username", async () => {
      class EmptyUsernameApp {
        emptyUsernameAction = $action({
          secure: {
            basic: {
              username: "",
              password: "somepassword",
            },
          },
          handler: () => "success",
        });
      }

      const emptyUserAlepha = Alepha.create()
        .with(AlephaServer)
        .with(AlephaSecurity)
        .with(EmptyUsernameApp);

      await emptyUserAlepha.start();

      const app = emptyUserAlepha.inject(EmptyUsernameApp);

      const result = await app.emptyUsernameAction.run({
        headers: {
          authorization: `Basic ${Buffer.from(":somepassword").toString("base64")}`,
        },
      });
      expect(result).toBe("success");

      await emptyUserAlepha.stop();
    });

    it("should reject invalid base64 encoding gracefully", async () => {
      const app = alepha.inject(TestApp);

      // Invalid base64 (not valid base64 characters)
      await expect(
        app.protectedAction.run({
          headers: {
            authorization: "Basic !!!invalid-base64!!!",
          },
        }),
      ).rejects.toThrow("Invalid credentials");
    });

    it("should reject Bearer token (wrong auth type)", async () => {
      const app = alepha.inject(TestApp);

      await expect(
        app.protectedAction.run({
          headers: {
            authorization: "Bearer some-jwt-token",
          },
        }),
      ).rejects.toThrow("Authentication required");
    });

    it("should reject lowercase 'basic' auth type", async () => {
      const app = alepha.inject(TestApp);

      // Note: HTTP headers are case-insensitive but "Basic" scheme is typically case-sensitive
      await expect(
        app.protectedAction.run({
          headers: {
            authorization: `basic ${Buffer.from("admin:secret123").toString("base64")}`,
          },
        }),
      ).rejects.toThrow("Authentication required");
    });

    it("should handle credentials without colon (malformed)", async () => {
      const app = alepha.inject(TestApp);

      // Base64 of just "admin" without colon
      await expect(
        app.protectedAction.run({
          headers: {
            authorization: `Basic ${Buffer.from("admin").toString("base64")}`,
          },
        }),
      ).rejects.toThrow("Invalid credentials");
    });

    it("should handle whitespace in credentials - valid", async () => {
      class WhitespaceApp {
        whitespaceAction = $action({
          secure: {
            basic: {
              username: " user ",
              password: " pass ",
            },
          },
          handler: () => "success",
        });
      }

      const wsAlepha = Alepha.create()
        .with(AlephaServer)
        .with(AlephaSecurity)
        .with(WhitespaceApp);

      await wsAlepha.start();

      const app = wsAlepha.inject(WhitespaceApp);

      // Whitespace should be preserved and matched exactly
      const result = await app.whitespaceAction.run({
        headers: {
          authorization: `Basic ${Buffer.from(" user : pass ").toString("base64")}`,
        },
      });
      expect(result).toBe("success");

      await wsAlepha.stop();
    });

    it("should handle whitespace in credentials - invalid", async () => {
      class WhitespaceApp {
        whitespaceAction = $action({
          secure: {
            basic: {
              username: " user ",
              password: " pass ",
            },
          },
          handler: () => "success",
        });
      }

      const wsAlepha = Alepha.create()
        .with(AlephaServer)
        .with(AlephaSecurity)
        .with(WhitespaceApp);

      await wsAlepha.start();

      const app = wsAlepha.inject(WhitespaceApp);

      // Without whitespace should fail
      await expect(
        app.whitespaceAction.run({
          headers: {
            authorization: `Basic ${Buffer.from("user:pass").toString("base64")}`,
          },
        }),
      ).rejects.toThrow("Invalid credentials");

      await wsAlepha.stop();
    });

    it("should give same error for wrong username vs wrong password (no info leakage)", async () => {
      const app = alepha.inject(TestApp);

      // Wrong username
      const wrongUserError = await app.protectedAction
        .run({
          headers: {
            authorization: `Basic ${Buffer.from("wronguser:secret123").toString("base64")}`,
          },
        })
        .catch((e) => e);

      // Wrong password
      const wrongPassError = await app.protectedAction
        .run({
          headers: {
            authorization: `Basic ${Buffer.from("admin:wrongpass").toString("base64")}`,
          },
        })
        .catch((e) => e);

      // Both wrong
      const bothWrongError = await app.protectedAction
        .run({
          headers: {
            authorization: `Basic ${Buffer.from("wronguser:wrongpass").toString("base64")}`,
          },
        })
        .catch((e) => e);

      // All should have the same error message (no information leakage)
      expect(wrongUserError.message).toBe("Invalid credentials");
      expect(wrongPassError.message).toBe("Invalid credentials");
      expect(bothWrongError.message).toBe("Invalid credentials");
    });

    it("should handle different length usernames correctly", async () => {
      const app = alepha.inject(TestApp);

      // Shorter username
      await expect(
        app.protectedAction.run({
          headers: {
            authorization: `Basic ${Buffer.from("adm:secret123").toString("base64")}`,
          },
        }),
      ).rejects.toThrow("Invalid credentials");

      // Longer username
      await expect(
        app.protectedAction.run({
          headers: {
            authorization: `Basic ${Buffer.from("administrator:secret123").toString("base64")}`,
          },
        }),
      ).rejects.toThrow("Invalid credentials");
    });

    it("should handle different length passwords correctly", async () => {
      const app = alepha.inject(TestApp);

      // Shorter password
      await expect(
        app.protectedAction.run({
          headers: {
            authorization: `Basic ${Buffer.from("admin:secret").toString("base64")}`,
          },
        }),
      ).rejects.toThrow("Invalid credentials");

      // Longer password
      await expect(
        app.protectedAction.run({
          headers: {
            authorization: `Basic ${Buffer.from("admin:secret123456789").toString("base64")}`,
          },
        }),
      ).rejects.toThrow("Invalid credentials");
    });
  });
});
