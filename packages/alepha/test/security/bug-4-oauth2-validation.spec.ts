import { Alepha } from "alepha/core";
import { describe, expect, it, vi } from "vitest";
import { $serviceAccount } from "../../src/security";

/**
 * Bug #4: Missing HTTP Response Validation in OAuth2 Service Account
 *
 * Issue: The OAuth2 token fetching code didn't:
 * 1. Check HTTP response.ok or status codes
 * 2. Handle JSON parsing errors
 * 3. Handle network errors properly
 * 4. Provide meaningful error messages
 *
 * Expected: All failure modes should throw clear errors instead of crashing.
 */
describe("Bug #4: Missing HTTP Response Validation in OAuth2", () => {
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
          throw new Error("Invalid JSON");
        }
        return isJson ? body : Promise.reject(new Error("Not JSON"));
      },
      text: async () =>
        typeof body === "string" ? body : JSON.stringify(body),
    } as Response;
  };

  it("should successfully fetch and cache token", async () => {
    const mockToken = "mock-access-token";
    const mockResponse = {
      access_token: mockToken,
      expires_in: 3600,
      token_type: "Bearer",
    };

    global.fetch = vi
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

  it("should throw error on network failure", async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error("Network error"));

    const serviceAccount = createServiceAccount(
      "https://auth.example.com/token",
      "test-client",
      "test-secret",
    );

    await expect(serviceAccount.token()).rejects.toThrow(
      /Failed to fetch access token from.*Network error/,
    );
  });

  it("should throw error on HTTP 400 Bad Request", async () => {
    const errorBody = {
      error: "invalid_request",
      error_description: "Missing parameter",
    };

    global.fetch = vi
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

  it("should throw error on HTTP 401 Unauthorized", async () => {
    const errorBody = { error: "invalid_client" };

    global.fetch = vi
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

  it("should throw error on HTTP 500 Internal Server Error", async () => {
    global.fetch = vi
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

  it("should throw error when response is not JSON", async () => {
    global.fetch = vi
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

  it("should throw error when response is missing access_token", async () => {
    const invalidResponse = {
      // Missing access_token
      expires_in: 3600,
      token_type: "Bearer",
    };

    global.fetch = vi
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

  it("should throw error when response is missing expires_in", async () => {
    const invalidResponse = {
      access_token: "token123",
      // Missing expires_in
      token_type: "Bearer",
    };

    global.fetch = vi
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

  it("should throw error when response has null access_token", async () => {
    const invalidResponse = {
      access_token: null,
      expires_in: 3600,
    };

    global.fetch = vi
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

  it("should throw error when response has empty string access_token", async () => {
    const invalidResponse = {
      access_token: "",
      expires_in: 3600,
    };

    global.fetch = vi
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

  it("should use cached token instead of fetching again", async () => {
    const mockToken = "cached-token";
    const mockResponse = {
      access_token: mockToken,
      expires_in: 3600,
      token_type: "Bearer",
    };

    const fetchMock = vi
      .fn()
      .mockResolvedValue(createMockResponse(200, mockResponse));
    global.fetch = fetchMock;

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

  it("should include error body in error message for non-200 responses", async () => {
    const errorBody = {
      error: "invalid_scope",
      error_description: "The requested scope is invalid",
    };

    global.fetch = vi
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

  it("should handle HTML error responses gracefully", async () => {
    const htmlError =
      "<html><body><h1>500 Internal Server Error</h1></body></html>";

    global.fetch = vi
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

  it("should handle fetch timeout or abort", async () => {
    global.fetch = vi
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

  it("should handle DNS resolution failure", async () => {
    global.fetch = vi
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

  it("should handle response with unexpected structure", async () => {
    const weirdResponse = {
      data: {
        token: "nested-token",
      },
      // Missing top-level access_token
    };

    global.fetch = vi
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

  it("should properly format URLSearchParams in request body", async () => {
    const mockResponse = {
      access_token: "token",
      expires_in: 3600,
    };

    const fetchMock = vi
      .fn()
      .mockResolvedValue(createMockResponse(200, mockResponse));
    global.fetch = fetchMock;

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
});
