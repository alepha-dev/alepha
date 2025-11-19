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

export interface BasicAuthDescriptorConfig extends BasicAuthOptions {
  /** Name identifier for this basic auth (default: property key) */
  name?: string;
  /** Path patterns to match (supports wildcards like /devtools/*) */
  paths?: string[];
}

// ---------------------------------------------------------------------------------------------------------------------

export class ServerBasicAuthProvider {
  protected readonly alepha = $inject(Alepha);
  protected readonly log = $logger();
  protected readonly routerProvider = $inject(ServerRouterProvider);
  protected readonly realm = "Secure Area";

  /**
   * Registered basic auth descriptors with their configurations
   */
  public readonly registeredAuths: BasicAuthDescriptorConfig[] = [];

  /**
   * Register a basic auth configuration (called by descriptors)
   */
  public registerAuth(config: BasicAuthDescriptorConfig): void {
    this.registeredAuths.push(config);
  }

  public readonly onStart = $hook({
    on: "start",
    handler: async () => {
      // Attach basicAuth to matching routes for each registered auth
      for (const auth of this.registeredAuths) {
        if (auth.paths) {
          for (const pattern of auth.paths) {
            // Use getRoutes() to find matching routes with pattern
            const matchedRoutes = this.routerProvider.getRoutes(pattern);

            // Attach basicAuth to each matched route
            for (const route of matchedRoutes) {
              route.basicAuth = {
                username: auth.username,
                password: auth.password,
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
      // Check per-route basic auth
      const routeAuth = route.basicAuth;
      if (routeAuth) {
        this.checkAuth(request, routeAuth);
      }
    },
  });

  /**
   * Hook into action:onRequest to check basic auth for actions
   */
  public readonly onActionRequest = $hook({
    on: "action:onRequest",
    handler: async ({ action, request }) => {
      // Check if this action has basic auth enabled
      const basicAuth = action.options?.basicAuth;
      if (!basicAuth) {
        return; // No basic auth for this action
      }

      this.checkAuth(request, basicAuth);
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

    // Decode base64 credentials
    const base64Credentials = authHeader.slice(6); // Remove "Basic "
    const credentials = Buffer.from(base64Credentials, "base64").toString(
      "utf-8",
    );
    // Split only on the first colon to handle passwords with colons
    const colonIndex = credentials.indexOf(":");
    const username =
      colonIndex !== -1 ? credentials.slice(0, colonIndex) : credentials;
    const password = colonIndex !== -1 ? credentials.slice(colonIndex + 1) : "";

    // Verify credentials
    if (username !== options.username || password !== options.password) {
      this.sendAuthRequired(request);
      this.log.warn(`Failed basic auth attempt for user`, {
        username,
      });
      throw new HttpError({
        status: 401,
        message: "Invalid credentials",
      });
    }

    // Authentication successful
  }

  /**
   * Send WWW-Authenticate header
   */
  protected sendAuthRequired(request: ServerRequest): void {
    request.reply.setHeader("WWW-Authenticate", `Basic realm="${this.realm}"`);
  }
}
