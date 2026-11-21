import { Alepha, AlephaError } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { afterEach, describe, it, vi } from "vitest";

import { $serviceAccount } from "../index.ts";

/**
 * `$serviceAccount` over the OAuth2 client credentials grant: what it sends,
 * what it caches and for how long, and the error each failure of the token
 * endpoint ends in.
 */
describe("$serviceAccount over OAuth2", () => {
  // The token endpoint is reached through the global `fetch`, which every
  // test below replaces: put back so nothing leaks into the next spec file
  // of this worker.
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  // Helper to create a service account within Alepha context
  const createServiceAccount = (
    url: string,
    clientId: string,
    clientSecret: string,
    gracePeriod?: number,
  ) => {
    const alepha = Alepha.create();

    class TestService {
      serviceAccount = $serviceAccount({
        oauth2: {
          url,
          clientId,
          clientSecret,
        },
        gracePeriod,
      });
    }

    const service = alepha.inject(TestService);
    return service.serviceAccount;
  };

  // Helper to create a mock fetch response
  const createMockResponse = (
    status: number,
    body: any,
    options: { isJson?: boolean; throwOnJson?: boolean } = {},
  ): Response => {
    const { isJson = true, throwOnJson = false } = options;

    return {
      ok: status >= 200 && status < 300,
      status,
      statusText:
        status === 200
          ? "OK"
          : status === 400
            ? "Bad Request"
            : status === 401
              ? "Unauthorized"
              : status === 500
                ? "Internal Server Error"
                : "Error",
      json: async () => {
        if (throwOnJson) {
          throw new AlephaError("Invalid JSON");
        }
        return isJson ? body : Promise.reject(new Error("Not JSON"));
      },
      text: async () =>
        typeof body === "string" ? body : JSON.stringify(body),
    } as Response;
  };

  it("should successfully fetch and cache token", async ({ expect }) => {
    const mockToken = "mock-access-token";
    const mockResponse = {
      access_token: mockToken,
      expires_in: 3600,
      token_type: "Bearer",
    };

    (global as any).fetch = vi
      .fn()
      .mockResolvedValue(createMockResponse(200, mockResponse));

    const serviceAccount = createServiceAccount(
      "https://auth.example.com/token",
      "test-client",
      "test-secret",
    );

    const token = await serviceAccount.token();
    expect(token).toBe(mockToken);

    // Verify fetch was called correctly
    expect(global.fetch).toHaveBeenCalledWith(
      "https://auth.example.com/token",
      expect.objectContaining({
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: expect.any(URLSearchParams),
      }),
    );
  });

  it("should throw error on network failure", async ({ expect }) => {
    (global as any).fetch = vi
      .fn()
      .mockRejectedValue(new Error("Network error"));

    const serviceAccount = createServiceAccount(
      "https://auth.example.com/token",
      "test-client",
      "test-secret",
    );

    await expect(serviceAccount.token()).rejects.toThrow(
      /Failed to fetch access token from.*Network error/,
    );
  });

  it("should throw error on HTTP 400 Bad Request", async ({ expect }) => {
    const errorBody = {
      error: "invalid_request",
      error_description: "Missing parameter",
    };

    (global as any).fetch = vi
      .fn()
      .mockResolvedValue(createMockResponse(400, errorBody));

    const serviceAccount = createServiceAccount(
      "https://auth.example.com/token",
      "test-client",
      "test-secret",
    );

    await expect(serviceAccount.token()).rejects.toThrow(
      /HTTP 400 Bad Request/,
    );
  });

  it("should throw error on HTTP 401 Unauthorized", async ({ expect }) => {
    const errorBody = { error: "invalid_client" };

    (global as any).fetch = vi
      .fn()
      .mockResolvedValue(createMockResponse(401, errorBody));

    const serviceAccount = createServiceAccount(
      "https://auth.example.com/token",
      "wrong-client",
      "wrong-secret",
    );

    await expect(serviceAccount.token()).rejects.toThrow(
      /HTTP 401 Unauthorized/,
    );
  });

  it("should throw error on HTTP 500 Internal Server Error", async ({
    expect,
  }) => {
    (global as any).fetch = vi
      .fn()
      .mockResolvedValue(createMockResponse(500, "Internal Server Error"));

    const serviceAccount = createServiceAccount(
      "https://auth.example.com/token",
      "test-client",
      "test-secret",
    );

    await expect(serviceAccount.token()).rejects.toThrow(
      /HTTP 500 Internal Server Error/,
    );
  });

  it("should throw error when response is not JSON", async ({ expect }) => {
    (global as any).fetch = vi
      .fn()
      .mockResolvedValue(
        createMockResponse(200, "Not a JSON response", { throwOnJson: true }),
      );

    const serviceAccount = createServiceAccount(
      "https://auth.example.com/token",
      "test-client",
      "test-secret",
    );

    await expect(serviceAccount.token()).rejects.toThrow(
      /Failed to parse access token response as JSON/,
    );
  });

  it("should throw error when response is missing access_token", async ({
    expect,
  }) => {
    const invalidResponse = {
      // Missing access_token
      expires_in: 3600,
      token_type: "Bearer",
    };

    (global as any).fetch = vi
      .fn()
      .mockResolvedValue(createMockResponse(200, invalidResponse));

    const serviceAccount = createServiceAccount(
      "https://auth.example.com/token",
      "test-client",
      "test-secret",
    );

    await expect(serviceAccount.token()).rejects.toThrow(
      /Invalid access token response: missing access_token or expires_in/,
    );
  });

  it("should throw error when response is missing expires_in", async ({
    expect,
  }) => {
    const invalidResponse = {
      access_token: "token123",
      // Missing expires_in
      token_type: "Bearer",
    };

    (global as any).fetch = vi
      .fn()
      .mockResolvedValue(createMockResponse(200, invalidResponse));

    const serviceAccount = createServiceAccount(
      "https://auth.example.com/token",
      "test-client",
      "test-secret",
    );

    await expect(serviceAccount.token()).rejects.toThrow(
      /Invalid access token response: missing access_token or expires_in/,
    );
  });

  it("should throw error when response has null access_token", async ({
    expect,
  }) => {
    const invalidResponse = {
      access_token: null,
      expires_in: 3600,
    };

    (global as any).fetch = vi
      .fn()
      .mockResolvedValue(createMockResponse(200, invalidResponse));

    const serviceAccount = createServiceAccount(
      "https://auth.example.com/token",
      "test-client",
      "test-secret",
    );

    await expect(serviceAccount.token()).rejects.toThrow(
      /Invalid access token response: missing access_token or expires_in/,
    );
  });

  it("should throw error when response has empty string access_token", async ({
    expect,
  }) => {
    const invalidResponse = {
      access_token: "",
      expires_in: 3600,
    };

    (global as any).fetch = vi
      .fn()
      .mockResolvedValue(createMockResponse(200, invalidResponse));

    const serviceAccount = createServiceAccount(
      "https://auth.example.com/token",
      "test-client",
      "test-secret",
    );

    await expect(serviceAccount.token()).rejects.toThrow(
      /Invalid access token response: missing access_token or expires_in/,
    );
  });

  it("should use cached token instead of fetching again", async ({
    expect,
  }) => {
    const mockToken = "cached-token";
    const mockResponse = {
      access_token: mockToken,
      expires_in: 3600,
      token_type: "Bearer",
    };

    const fetchMock = vi
      .fn()
      .mockResolvedValue(createMockResponse(200, mockResponse));
    (global as any).fetch = fetchMock;

    const serviceAccount = createServiceAccount(
      "https://auth.example.com/token",
      "test-client",
      "test-secret",
      30,
    );

    // First call should fetch
    const token1 = await serviceAccount.token();
    expect(token1).toBe(mockToken);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Second call should use cache
    const token2 = await serviceAccount.token();
    expect(token2).toBe(mockToken);
    expect(fetchMock).toHaveBeenCalledTimes(1); // Still 1, not called again
  });

  it("should include error body in error message for non-200 responses", async ({
    expect,
  }) => {
    const errorBody = {
      error: "invalid_scope",
      error_description: "The requested scope is invalid",
    };

    (global as any).fetch = vi
      .fn()
      .mockResolvedValue(createMockResponse(400, errorBody));

    const serviceAccount = createServiceAccount(
      "https://auth.example.com/token",
      "test-client",
      "test-secret",
    );

    try {
      await serviceAccount.token();
      expect.fail("Should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toContain("HTTP 400 Bad Request");
      expect((error as Error).message).toContain("invalid_scope");
    }
  });

  it("should handle HTML error responses gracefully", async ({ expect }) => {
    const htmlError =
      "<html><body><h1>500 Internal Server Error</h1></body></html>";

    (global as any).fetch = vi
      .fn()
      .mockResolvedValue(
        createMockResponse(500, htmlError, { throwOnJson: true }),
      );

    const serviceAccount = createServiceAccount(
      "https://auth.example.com/token",
      "test-client",
      "test-secret",
    );

    await expect(serviceAccount.token()).rejects.toThrow(/HTTP 500/);
  });

  it("should handle fetch timeout or abort", async ({ expect }) => {
    (global as any).fetch = vi
      .fn()
      .mockRejectedValue(new Error("The operation was aborted"));

    const serviceAccount = createServiceAccount(
      "https://auth.example.com/token",
      "test-client",
      "test-secret",
    );

    await expect(serviceAccount.token()).rejects.toThrow(
      /Failed to fetch access token.*aborted/,
    );
  });

  it("should handle DNS resolution failure", async ({ expect }) => {
    (global as any).fetch = vi
      .fn()
      .mockRejectedValue(
        new Error("getaddrinfo ENOTFOUND invalid-domain.example"),
      );

    const serviceAccount = createServiceAccount(
      "https://invalid-domain.example/token",
      "test-client",
      "test-secret",
    );

    await expect(serviceAccount.token()).rejects.toThrow(/ENOTFOUND/);
  });

  it("should handle response with unexpected structure", async ({ expect }) => {
    const weirdResponse = {
      data: {
        token: "nested-token",
      },
      // Missing top-level access_token
    };

    (global as any).fetch = vi
      .fn()
      .mockResolvedValue(createMockResponse(200, weirdResponse));

    const serviceAccount = createServiceAccount(
      "https://auth.example.com/token",
      "test-client",
      "test-secret",
    );

    await expect(serviceAccount.token()).rejects.toThrow(
      /Invalid access token response/,
    );
  });

  it("should properly format URLSearchParams in request body", async ({
    expect,
  }) => {
    const mockResponse = {
      access_token: "token",
      expires_in: 3600,
    };

    const fetchMock = vi
      .fn()
      .mockResolvedValue(createMockResponse(200, mockResponse));
    (global as any).fetch = fetchMock;

    const serviceAccount = createServiceAccount(
      "https://auth.example.com/token",
      "my-client-id",
      "my-secret",
    );

    await serviceAccount.token();

    const callArgs = fetchMock.mock.calls[0];
    const body = callArgs[1].body as URLSearchParams;

    expect(body.get("grant_type")).toBe("client_credentials");
    expect(body.get("client_id")).toBe("my-client-id");
    expect(body.get("client_secret")).toBe("my-secret");
  });

  describe("expires_in as the provider sends it", () => {
    const setup = (expiresIn: unknown) => {
      let calls = 0;
      (global as any).fetch = vi.fn().mockImplementation(async () => {
        calls += 1;
        return createMockResponse(200, {
          access_token: `token-${calls}`,
          expires_in: expiresIn,
          // Some providers send one, in their own unit. Ours is the clock.
          issued_at: "1700000000000",
        });
      });

      const alepha = Alepha.create();

      class TestService {
        serviceAccount = $serviceAccount({
          oauth2: {
            url: "https://auth.example.com/token",
            clientId: "test-client",
            clientSecret: "test-secret",
          },
        });
      }

      return {
        serviceAccount: alepha.inject(TestService).serviceAccount,
        time: alepha.inject(DateTimeProvider),
        calls: () => calls,
      };
    };

    it("expires a token whose lifetime is a numeric string", async ({
      expect,
    }) => {
      const { serviceAccount, time, calls } = setup("3600");

      expect(await serviceAccount.token()).toBe("token-1");
      await time.travel([30, "minutes"]);
      expect(await serviceAccount.token()).toBe("token-1");
      expect(calls()).toBe(1);

      await time.travel([2, "days"]);
      expect(await serviceAccount.token()).toBe("token-2");
      expect(calls()).toBe(2);
    });

    it("expires a token whose lifetime is a number, whatever issue time the provider sent", async ({
      expect,
    }) => {
      const { serviceAccount, time } = setup(3600);

      expect(await serviceAccount.token()).toBe("token-1");
      await time.travel([2, "hours"]);
      expect(await serviceAccount.token()).toBe("token-2");
    });

    for (const expiresIn of ["soon", -60, "-60", true]) {
      it(`returns a token whose lifetime is ${JSON.stringify(expiresIn)} without caching it`, async ({
        expect,
      }) => {
        const { serviceAccount, calls } = setup(expiresIn);

        expect(await serviceAccount.token()).toBe("token-1");
        expect(await serviceAccount.token()).toBe("token-2");
        expect(calls()).toBe(2);
      });
    }
  });
});
