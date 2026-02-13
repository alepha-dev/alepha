import { Alepha } from "alepha";
import { $action, AlephaServer } from "alepha/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { $basicAuth, AlephaSecurity } from "../index.ts";

describe("Basic Authentication", () => {
  let alepha: Alepha;

  class TestApp {
    protectedAction = $action({
      use: [$basicAuth({ username: "admin", password: "secret123" })],
      handler: () => "protected success",
    });

    publicAction = $action({
      handler: () => "public success",
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

  describe("$basicAuth middleware", () => {
    it("should allow requests with valid credentials", async () => {
      const app = alepha.inject(TestApp);

      const result = await app.protectedAction.fetch({
        headers: {
          authorization: `Basic ${Buffer.from("admin:secret123").toString("base64")}`,
        },
      });

      expect(result.data).toBe("protected success");
    });

    it("should block requests without credentials", async () => {
      const app = alepha.inject(TestApp);

      await expect(app.protectedAction.fetch({})).rejects.toThrow(
        "Authentication required",
      );
    });

    it("should block requests with invalid credentials", async () => {
      const app = alepha.inject(TestApp);

      await expect(
        app.protectedAction.fetch({
          headers: {
            authorization: `Basic ${Buffer.from("admin:wrongpass").toString("base64")}`,
          },
        }),
      ).rejects.toThrow("Invalid credentials");
    });

    it("should block requests with invalid username", async () => {
      const app = alepha.inject(TestApp);

      await expect(
        app.protectedAction.fetch({
          headers: {
            authorization: `Basic ${Buffer.from("wronguser:secret123").toString("base64")}`,
          },
        }),
      ).rejects.toThrow("Invalid credentials");
    });

    it("should allow public actions without authentication", async () => {
      const app = alepha.inject(TestApp);

      const result = await app.publicAction.fetch({});
      expect(result.data).toBe("public success");
    });

    it("should handle malformed authorization header", async () => {
      const app = alepha.inject(TestApp);

      await expect(
        app.protectedAction.fetch({
          headers: {
            authorization: "InvalidHeader",
          },
        }),
      ).rejects.toThrow("Authentication required");
    });
  });

  describe("Integration", () => {
    it("should integrate basic auth with action middleware pipeline", async () => {
      const app = alepha.inject(TestApp);

      // Should work with valid credentials
      const result = await app.protectedAction.fetch({
        headers: {
          authorization: `Basic ${Buffer.from("admin:secret123").toString("base64")}`,
        },
      });
      expect(result.data).toBe("protected success");

      // Should fail without credentials
      await expect(app.protectedAction.fetch({})).rejects.toThrow(
        "Authentication required",
      );
    });

    it("should work with case-sensitive credentials", async () => {
      const app = alepha.inject(TestApp);

      // Correct case should work
      const result = await app.protectedAction.fetch({
        headers: {
          authorization: `Basic ${Buffer.from("admin:secret123").toString("base64")}`,
        },
      });
      expect(result.data).toBe("protected success");

      // Wrong case should fail
      await expect(
        app.protectedAction.fetch({
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
          use: [$basicAuth({ username: "user", password: "pass:word:123" })],
          handler: () => "success",
        });
      }

      const edgeAlepha = Alepha.create()
        .with(AlephaServer)
        .with(AlephaSecurity)
        .with(EdgeCaseApp);

      await edgeAlepha.start();

      const app = edgeAlepha.inject(EdgeCaseApp);

      const result = await app.colonPasswordAction.fetch({
        headers: {
          authorization: `Basic ${Buffer.from("user:pass:word:123").toString("base64")}`,
        },
      });
      expect(result.data).toBe("success");

      await edgeAlepha.stop();
    });

    it("should handle empty password", async () => {
      class EmptyPasswordApp {
        emptyPasswordAction = $action({
          use: [$basicAuth({ username: "user", password: "" })],
          handler: () => "success",
        });
      }

      const emptyAlepha = Alepha.create()
        .with(AlephaServer)
        .with(AlephaSecurity)
        .with(EmptyPasswordApp);

      await emptyAlepha.start();

      const app = emptyAlepha.inject(EmptyPasswordApp);

      const result = await app.emptyPasswordAction.fetch({
        headers: {
          authorization: `Basic ${Buffer.from("user:").toString("base64")}`,
        },
      });
      expect(result.data).toBe("success");

      await emptyAlepha.stop();
    });

    it("should handle special characters in credentials", async () => {
      class SpecialCharsApp {
        specialCharsAction = $action({
          use: [
            $basicAuth({
              username: "user@domain.com",
              password: "p@$$w0rd!#$%",
            }),
          ],
          handler: () => "success",
        });
      }

      const specialAlepha = Alepha.create()
        .with(AlephaServer)
        .with(AlephaSecurity)
        .with(SpecialCharsApp);

      await specialAlepha.start();

      const app = specialAlepha.inject(SpecialCharsApp);

      const result = await app.specialCharsAction.fetch({
        headers: {
          authorization: `Basic ${Buffer.from("user@domain.com:p@$$w0rd!#$%").toString("base64")}`,
        },
      });
      expect(result.data).toBe("success");

      await specialAlepha.stop();
    });

    it("should handle unicode characters (UTF-8) in credentials - valid", async () => {
      class UnicodeApp {
        unicodeAction = $action({
          use: [$basicAuth({ username: "用户名", password: "密码🔐émoji" })],
          handler: () => "success",
        });
      }

      const unicodeAlepha = Alepha.create()
        .with(AlephaServer)
        .with(AlephaSecurity)
        .with(UnicodeApp);

      await unicodeAlepha.start();

      const app = unicodeAlepha.inject(UnicodeApp);

      const result = await app.unicodeAction.fetch({
        headers: {
          authorization: `Basic ${Buffer.from("用户名:密码🔐émoji").toString("base64")}`,
        },
      });
      expect(result.data).toBe("success");

      await unicodeAlepha.stop();
    });

    it("should handle unicode characters (UTF-8) in credentials - invalid", async () => {
      class UnicodeApp {
        unicodeAction = $action({
          use: [$basicAuth({ username: "用户名", password: "密码🔐émoji" })],
          handler: () => "success",
        });
      }

      const unicodeAlepha = Alepha.create()
        .with(AlephaServer)
        .with(AlephaSecurity)
        .with(UnicodeApp);

      await unicodeAlepha.start();

      const app = unicodeAlepha.inject(UnicodeApp);

      await expect(
        app.unicodeAction.fetch({
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
          use: [
            $basicAuth({
              username: longUsername,
              password: longPassword,
            }),
          ],
          handler: () => "success",
        });
      }

      const longAlepha = Alepha.create()
        .with(AlephaServer)
        .with(AlephaSecurity)
        .with(LongCredsApp);

      await longAlepha.start();

      const app = longAlepha.inject(LongCredsApp);

      const result = await app.longCredsAction.fetch({
        headers: {
          authorization: `Basic ${Buffer.from(`${longUsername}:${longPassword}`).toString("base64")}`,
        },
      });
      expect(result.data).toBe("success");

      await longAlepha.stop();
    });

    it("should handle empty username", async () => {
      class EmptyUsernameApp {
        emptyUsernameAction = $action({
          use: [$basicAuth({ username: "", password: "somepassword" })],
          handler: () => "success",
        });
      }

      const emptyUserAlepha = Alepha.create()
        .with(AlephaServer)
        .with(AlephaSecurity)
        .with(EmptyUsernameApp);

      await emptyUserAlepha.start();

      const app = emptyUserAlepha.inject(EmptyUsernameApp);

      const result = await app.emptyUsernameAction.fetch({
        headers: {
          authorization: `Basic ${Buffer.from(":somepassword").toString("base64")}`,
        },
      });
      expect(result.data).toBe("success");

      await emptyUserAlepha.stop();
    });

    it("should reject invalid base64 encoding gracefully", async () => {
      const app = alepha.inject(TestApp);

      // Invalid base64 (not valid base64 characters)
      await expect(
        app.protectedAction.fetch({
          headers: {
            authorization: "Basic !!!invalid-base64!!!",
          },
        }),
      ).rejects.toThrow("Invalid credentials");
    });

    it("should reject Bearer token (wrong auth type)", async () => {
      const app = alepha.inject(TestApp);

      await expect(
        app.protectedAction.fetch({
          headers: {
            authorization: "Bearer some-jwt-token",
          },
        }),
      ).rejects.toThrow("Authentication required");
    });

    it("should reject lowercase 'basic' auth type", async () => {
      const app = alepha.inject(TestApp);

      await expect(
        app.protectedAction.fetch({
          headers: {
            authorization: `basic ${Buffer.from("admin:secret123").toString("base64")}`,
          },
        }),
      ).rejects.toThrow("Authentication required");
    });

    it("should handle credentials without colon (malformed)", async () => {
      const app = alepha.inject(TestApp);

      await expect(
        app.protectedAction.fetch({
          headers: {
            authorization: `Basic ${Buffer.from("admin").toString("base64")}`,
          },
        }),
      ).rejects.toThrow("Invalid credentials");
    });

    it("should handle whitespace in credentials - valid", async () => {
      class WhitespaceApp {
        whitespaceAction = $action({
          use: [$basicAuth({ username: " user ", password: " pass " })],
          handler: () => "success",
        });
      }

      const wsAlepha = Alepha.create()
        .with(AlephaServer)
        .with(AlephaSecurity)
        .with(WhitespaceApp);

      await wsAlepha.start();

      const app = wsAlepha.inject(WhitespaceApp);

      const result = await app.whitespaceAction.fetch({
        headers: {
          authorization: `Basic ${Buffer.from(" user : pass ").toString("base64")}`,
        },
      });
      expect(result.data).toBe("success");

      await wsAlepha.stop();
    });

    it("should handle whitespace in credentials - invalid", async () => {
      class WhitespaceApp {
        whitespaceAction = $action({
          use: [$basicAuth({ username: " user ", password: " pass " })],
          handler: () => "success",
        });
      }

      const wsAlepha = Alepha.create()
        .with(AlephaServer)
        .with(AlephaSecurity)
        .with(WhitespaceApp);

      await wsAlepha.start();

      const app = wsAlepha.inject(WhitespaceApp);

      await expect(
        app.whitespaceAction.fetch({
          headers: {
            authorization: `Basic ${Buffer.from("user:pass").toString("base64")}`,
          },
        }),
      ).rejects.toThrow("Invalid credentials");

      await wsAlepha.stop();
    });

    it("should give same error for wrong username vs wrong password (no info leakage)", async () => {
      const app = alepha.inject(TestApp);

      const wrongUserError = await app.protectedAction
        .fetch({
          headers: {
            authorization: `Basic ${Buffer.from("wronguser:secret123").toString("base64")}`,
          },
        })
        .catch((e) => e);

      const wrongPassError = await app.protectedAction
        .fetch({
          headers: {
            authorization: `Basic ${Buffer.from("admin:wrongpass").toString("base64")}`,
          },
        })
        .catch((e) => e);

      const bothWrongError = await app.protectedAction
        .fetch({
          headers: {
            authorization: `Basic ${Buffer.from("wronguser:wrongpass").toString("base64")}`,
          },
        })
        .catch((e) => e);

      expect(wrongUserError.message).toBe("Invalid credentials");
      expect(wrongPassError.message).toBe("Invalid credentials");
      expect(bothWrongError.message).toBe("Invalid credentials");
    });

    it("should handle different length usernames correctly", async () => {
      const app = alepha.inject(TestApp);

      await expect(
        app.protectedAction.fetch({
          headers: {
            authorization: `Basic ${Buffer.from("adm:secret123").toString("base64")}`,
          },
        }),
      ).rejects.toThrow("Invalid credentials");

      await expect(
        app.protectedAction.fetch({
          headers: {
            authorization: `Basic ${Buffer.from("administrator:secret123").toString("base64")}`,
          },
        }),
      ).rejects.toThrow("Invalid credentials");
    });

    it("should handle different length passwords correctly", async () => {
      const app = alepha.inject(TestApp);

      await expect(
        app.protectedAction.fetch({
          headers: {
            authorization: `Basic ${Buffer.from("admin:secret").toString("base64")}`,
          },
        }),
      ).rejects.toThrow("Invalid credentials");

      await expect(
        app.protectedAction.fetch({
          headers: {
            authorization: `Basic ${Buffer.from("admin:secret123456789").toString("base64")}`,
          },
        }),
      ).rejects.toThrow("Invalid credentials");
    });
  });
});
