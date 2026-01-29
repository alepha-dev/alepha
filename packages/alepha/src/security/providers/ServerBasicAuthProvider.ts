import { timingSafeEqual } from "node:crypto";
import { $hook, $inject, Alepha } from "alepha";
import { $logger } from "alepha/logger";
import {
  HttpError,
  type ServerRequest,
  ServerRouterProvider,
} from "alepha/server";

// ---------------------------------------------------------------------------------------------------------------------

export interface BasicAuthOptions {
  username: string;
  password: string;
}

export interface BasicAuthPrimitiveConfig extends BasicAuthOptions {
  /**
   * Name identifier for this basic auth (default: property key).
   */
  name?: string;
  /**
   * Path patterns to match (supports wildcards like /devtools/*).
   */
  paths?: string[];
}

// ---------------------------------------------------------------------------------------------------------------------

export class ServerBasicAuthProvider {
  protected readonly alepha = $inject(Alepha);
  protected readonly log = $logger();
  protected readonly routerProvider = $inject(ServerRouterProvider);
  protected readonly realm = "Secure Area";

  /**
   * Registered basic auth primitives with their configurations
   */
  public readonly registeredAuths: BasicAuthPrimitiveConfig[] = [];

  /**
   * Register a basic auth configuration (called by primitives)
   */
  public registerAuth(config: BasicAuthPrimitiveConfig): void {
    this.registeredAuths.push(config);
  }

  public readonly onStart = $hook({
    on: "start",
    handler: async () => {
      for (const auth of this.registeredAuths) {
        if (auth.paths) {
          for (const pattern of auth.paths) {
            const matchedRoutes = this.routerProvider.getRoutes(pattern);
            for (const route of matchedRoutes) {
              route.secure = {
                basic: {
                  username: auth.username,
                  password: auth.password,
                },
              };
            }
          }
        }
      }

      if (this.registeredAuths.length > 0) {
        this.log.info(
          `Initialized with ${this.registeredAuths.length} registered basic-auth configurations.`,
        );
      }
    },
  });

  /**
   * Hook into server:onRequest to check basic auth
   */
  public readonly onRequest = $hook({
    on: "server:onRequest",
    handler: async ({ route, request }) => {
      const routeAuth = route.secure;
      if (
        typeof routeAuth === "object" &&
        "basic" in routeAuth &&
        routeAuth.basic
      ) {
        this.checkAuth(request, routeAuth.basic);
      }
    },
  });

  /**
   * Hook into action:onRequest to check basic auth for actions
   */
  public readonly onActionRequest = $hook({
    on: "action:onRequest",
    handler: async ({ action, request }) => {
      const routeAuth = action.route.secure;
      if (isBasicAuth(routeAuth)) {
        this.checkAuth(request, routeAuth.basic);
      }
    },
  });

  /**
   * Check basic authentication
   */
  public checkAuth(request: ServerRequest, options: BasicAuthOptions): void {
    const authHeader = request.headers?.authorization;

    if (!authHeader || !authHeader.startsWith("Basic ")) {
      this.sendAuthRequired(request);
      throw new HttpError({
        status: 401,
        message: "Authentication required",
      });
    }

    // decode base64 credentials
    const base64Credentials = authHeader.slice(6); // Remove "Basic "
    const credentials = Buffer.from(base64Credentials, "base64").toString(
      "utf-8",
    );

    // split only on the first colon to handle passwords with colons
    const colonIndex = credentials.indexOf(":");
    const username =
      colonIndex !== -1 ? credentials.slice(0, colonIndex) : credentials;
    const password = colonIndex !== -1 ? credentials.slice(colonIndex + 1) : "";

    // verify credentials using timing-safe comparison to prevent timing attacks
    const isValid = this.timingSafeCredentialCheck(
      username,
      password,
      options.username,
      options.password,
    );

    if (!isValid) {
      this.sendAuthRequired(request);
      this.log.warn(`Failed basic auth attempt for user`, {
        username,
      });
      throw new HttpError({
        status: 401,
        message: "Invalid credentials",
      });
    }
  }

  /**
   * Performs a timing-safe comparison of credentials to prevent timing attacks.
   * Always compares both username and password to avoid leaking which one is wrong.
   */
  protected timingSafeCredentialCheck(
    inputUsername: string,
    inputPassword: string,
    expectedUsername: string,
    expectedPassword: string,
  ): boolean {
    // Convert to buffers for timing-safe comparison
    const inputUserBuf = Buffer.from(inputUsername, "utf-8");
    const expectedUserBuf = Buffer.from(expectedUsername, "utf-8");
    const inputPassBuf = Buffer.from(inputPassword, "utf-8");
    const expectedPassBuf = Buffer.from(expectedPassword, "utf-8");

    // timingSafeEqual requires same-length buffers
    // When lengths differ, we compare against a dummy buffer to maintain constant time
    const userMatch = this.safeCompare(inputUserBuf, expectedUserBuf);
    const passMatch = this.safeCompare(inputPassBuf, expectedPassBuf);

    // Both must match - bitwise AND avoids short-circuit evaluation
    // eslint-disable-next-line no-bitwise
    return (userMatch & passMatch) === 1;
  }

  /**
   * Compares two buffers in constant time, handling different lengths safely.
   * Returns 1 if equal, 0 if not equal.
   */
  protected safeCompare(input: Buffer, expected: Buffer): number {
    // If lengths differ, compare input against itself to maintain timing
    // but return 0 (not equal)
    if (input.length !== expected.length) {
      // Still perform a comparison to keep timing consistent
      timingSafeEqual(input, input);
      return 0;
    }

    return timingSafeEqual(input, expected) ? 1 : 0;
  }

  /**
   * Send WWW-Authenticate header
   */
  protected sendAuthRequired(request: ServerRequest): void {
    request.reply.setHeader("WWW-Authenticate", `Basic realm="${this.realm}"`);
  }
}

export const isBasicAuth = (
  value: unknown,
): value is { basic: BasicAuthOptions } => {
  return (
    typeof value === "object" && !!value && "basic" in value && !!value.basic
  );
};
