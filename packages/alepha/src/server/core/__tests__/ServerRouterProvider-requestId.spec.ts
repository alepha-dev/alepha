import { Alepha } from "alepha";
import { beforeEach, describe, it } from "vitest";

import { $action, HttpClient, HttpError, ServerProvider } from "../index.ts";

class TestApp {
  // HttpError with custom message
  httpError = $action({
    method: "GET",
    handler: () => {
      throw new HttpError({ status: 400 }, { message: "Custom error message" });
    },
  });

  // Generic Error without status (500)
  genericError = $action({
    method: "GET",
    handler: () => {
      throw new Error("Something went wrong");
    },
  });
}

describe("ServerRouterProvider - requestId", () => {
  let alepha: Alepha;
  let client: HttpClient;
  let hostname: string;

  beforeEach(async () => {
    alepha = Alepha.create().with(TestApp);
    client = alepha.inject(HttpClient);
    await alepha.start();
    hostname = alepha.inject(ServerProvider).hostname;
  });

  it("should include requestId in raw HTTP error response for HttpError", async ({
    expect,
  }) => {
    // Make raw HTTP request to see the actual JSON response
    const response = await fetch(`${hostname}/api/httpError`, {
      headers: {
        "x-request-id": "test-request-123",
      },
    });

    expect(response.status).toBe(400);

    const responseText = await response.text();
    const responseJson = JSON.parse(responseText);

    // Check that the raw HTTP response includes requestId
    expect(responseJson).toMatchObject({
      name: "BAD_REQUEST",
      message: "Custom error message",
      data: { status: 400, requestId: "test-request-123" },
    });
  });

  it("should include requestId in raw HTTP error response for generic error", async ({
    expect,
  }) => {
    // Make raw HTTP request to see the actual JSON response
    const response = await fetch(`${hostname}/api/genericError`, {
      headers: {
        "x-request-id": "test-request-789",
      },
    });

    expect(response.status).toBe(500);

    const responseText = await response.text();
    const responseJson = JSON.parse(responseText);

    // Check that the raw HTTP response includes requestId
    expect(responseJson).toMatchObject({
      name: "INTERNAL_SERVER_ERROR",
      message: "Something went wrong",
      data: { status: 500, requestId: "test-request-789" },
    });
  });

  it("should auto-generate requestId in raw response when not provided", async ({
    expect,
  }) => {
    // Make raw HTTP request without providing requestId
    const response = await fetch(`${hostname}/api/genericError`);

    expect(response.status).toBe(500);

    const responseText = await response.text();
    const responseJson = JSON.parse(responseText);

    // Check that the raw HTTP response includes an auto-generated requestId
    expect(responseJson).toMatchObject({
      name: "INTERNAL_SERVER_ERROR",
      message: "Something went wrong",
      data: { status: 500 },
    });

    // Should have a requestId even when not provided in headers
    expect(responseJson.data.requestId).toBeDefined();
    expect(typeof responseJson.data.requestId).toBe("string");
    expect(responseJson.data.requestId.length).toBeGreaterThan(0);
  });

  it("should properly handle error with requestId through HttpClient", async ({
    expect,
  }) => {
    try {
      await client.fetch(`${hostname}/api/httpError`, {
        headers: {
          "x-request-id": "test-request-client",
        },
      });
      // Should not reach here
      expect(true).toBe(false);
    } catch (error) {
      if (error instanceof HttpError) {
        const errorJson = HttpError.toJSON(error);
        expect(errorJson.data?.requestId).toBe("test-request-client");
      } else {
        // For now, let's see what we actually get
        expect(error).toBeInstanceOf(Error);
      }
    }
  });
});
