import { timingSafeEqual } from "node:crypto";

import { AlephaError, createMiddleware, type Middleware } from "alepha";
import { HttpError, type ServerRequest } from "alepha/server";

export interface BasicAuthOptions {
  username: string;
  /**
   * Must not be empty: see {@link $basicAuth}.
   */
  password: string;
}

/**
 * Middleware that enforces HTTP Basic Authentication on the request.
 *
 * Works with request context only (HTTP). Reads the `Authorization: Basic` header,
 * validates credentials using timing-safe comparison, and throws 401 if invalid.
 *
 * ```typescript
 * class DevToolsController {
 *   dashboard = $action({
 *     use: [$basicAuth({ username: "admin", password: "secret" })],
 *     handler: async () => { ... },
 *   });
 * }
 * ```
 *
 * **An empty password is refused when the middleware is declared**, with an
 * `AlephaError`. It would admit anyone who sends the username with no
 * password, and the usual way to get one is an unset variable read as
 * `password: this.env.SECRET ?? ""`: the gate then fails open, silently,
 * exactly when its configuration is missing. Refusing at declaration makes
 * that app fail to start instead.
 */
export function $basicAuth(options: BasicAuthOptions): Middleware {
  if (!options.password) {
    throw new AlephaError(
      "$basicAuth needs a non-empty password: an empty one admits anyone who " +
        "sends the username with no password. If it comes from an environment " +
        "variable, that variable is unset or empty.",
    );
  }
  return createMiddleware({
    name: "$basicAuth",
    options: options as unknown as Record<string, unknown>,
    handler: ({ alepha, next }) => {
      return async (...args: any[]) => {
        const request = alepha.store.get("alepha.http.request");

        if (!request?.headers) {
          throw new HttpError({
            status: 401,
            message: "Authentication required",
          });
        }

        const authHeader = request.headers.authorization;

        if (!authHeader?.startsWith("Basic ")) {
          sendAuthRequired(request);
          throw new HttpError({
            status: 401,
            message: "Authentication required",
          });
        }

        // Decode base64 credentials
        const base64Credentials = authHeader.slice(6);
        const credentials = Buffer.from(base64Credentials, "base64").toString(
          "utf-8",
        );

        // Split only on the first colon to handle passwords with colons
        const colonIndex = credentials.indexOf(":");
        const username =
          colonIndex !== -1 ? credentials.slice(0, colonIndex) : credentials;
        const password =
          colonIndex !== -1 ? credentials.slice(colonIndex + 1) : "";

        // Verify credentials using timing-safe comparison
        const isValid = timingSafeCredentialCheck(
          username,
          password,
          options.username,
          options.password,
        );

        if (!isValid) {
          sendAuthRequired(request);
          throw new HttpError({
            status: 401,
            message: "Invalid credentials",
          });
        }

        return next(...args);
      };
    },
  });
}

// =====================================================================================================================

function sendAuthRequired(request: ServerRequest): void {
  request.reply?.setHeader("WWW-Authenticate", 'Basic realm="Secure Area"');
}

function timingSafeCredentialCheck(
  inputUsername: string,
  inputPassword: string,
  expectedUsername: string,
  expectedPassword: string,
): boolean {
  const inputUserBuf = Buffer.from(inputUsername, "utf-8");
  const expectedUserBuf = Buffer.from(expectedUsername, "utf-8");
  const inputPassBuf = Buffer.from(inputPassword, "utf-8");
  const expectedPassBuf = Buffer.from(expectedPassword, "utf-8");

  const userMatch = safeCompare(inputUserBuf, expectedUserBuf);
  const passMatch = safeCompare(inputPassBuf, expectedPassBuf);

  // Both must match — bitwise AND avoids short-circuit evaluation
  return (userMatch & passMatch) === 1;
}

function safeCompare(input: Buffer, expected: Buffer): number {
  if (input.length !== expected.length) {
    timingSafeEqual(input, input);
    return 0;
  }
  return timingSafeEqual(input, expected) ? 1 : 0;
}
