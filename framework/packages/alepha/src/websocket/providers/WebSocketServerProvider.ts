import {
  $inject,
  Alepha,
  AlephaError,
  MIDDLEWARE_PROTECTED,
  type Middleware,
  PipelineHandler,
} from "alepha";
import { OPTIONS } from "alepha/internal";
import { HttpError, RequestOriginPolicy } from "alepha/server";

import type { RoomPrimitiveOptions } from "../interfaces/RoomInterfaces.ts";
import type {
  EmitOptions,
  WebSocketAdmissionOptions,
  WebSocketAdmissionResult,
  WebSocketConnection,
  WebSocketHandshake,
  WebSocketPrimitiveOptions,
} from "../interfaces/WebSocketInterfaces.ts";
import type { TWSObject } from "../primitives/$channel.ts";

/**
 * Abstract WebSocket server provider
 *
 * This class provides the base interface that must be implemented by
 * platform-specific providers (Node.js, Browser, etc.)
 */
export abstract class WebSocketServerProvider {
  public static readonly id: string =
    "alepha.websocket.WebSocketServerProvider";
  protected readonly alepha = $inject(Alepha);
  protected readonly originPolicy = $inject(RequestOriginPolicy);

  /**
   * Register a WebSocket endpoint with its channel configuration
   */
  abstract registerEndpoint<
    TClient extends TWSObject,
    TServer extends TWSObject,
  >(config: WebSocketPrimitiveOptions<TClient, TServer>): void;

  /**
   * Look up a registered endpoint by its channel path.
   */
  abstract getEndpoint(
    channelPath: string,
  ): WebSocketPrimitiveOptions<any, any> | undefined;

  /**
   * Emit a message to clients based on targeting criteria
   *
   * This method distributes messages across all server instances via pub/sub.
   */
  abstract emit<TClient extends TWSObject>(
    channelPath: string,
    options: EmitOptions<TClient>,
  ): Promise<void>;

  /**
   * Get all active connections (local to this server instance)
   */
  abstract getConnections(): WebSocketConnection[];

  /**
   * Get connections in a specific room (local to this server instance)
   */
  abstract getRoomConnections(roomId: string): WebSocketConnection[];

  /**
   * Get connections for a specific user (local to this server instance)
   */
  abstract getUserConnections(userId: string): WebSocketConnection[];

  /**
   * Close a specific connection
   */
  abstract closeConnection(
    connectionId: string,
    code?: number,
    reason?: string,
  ): Promise<void>;

  // -------------------------------------------------------------------------
  // Stateful rooms ($room). A room is a stateful, optionally tick-driven
  // endpoint. Node hosts one RoomEngine per channel:room in-process;
  // Cloudflare hosts one Durable Object per channel:room.
  // -------------------------------------------------------------------------

  /**
   * Register a stateful room endpoint (the {@link RoomPrimitiveOptions} of a
   * `$room`).
   */
  abstract registerRoom(options: RoomPrimitiveOptions<any, any, any>): void;

  /**
   * Look up a registered room endpoint by its channel path.
   */
  abstract getRoomEndpoint(
    channelPath: string,
  ): RoomPrimitiveOptions<any, any, any> | undefined;

  /**
   * Invoke a server-side method on one room, by id. Brings a headless room to
   * life on first call.
   */
  abstract callRoom(
    channelPath: string,
    roomId: string,
    method: string,
    args?: unknown[],
  ): Promise<unknown>;

  /**
   * Push a server-initiated message to every socket in one live room. A no-op
   * if that room holds no connections.
   */
  abstract broadcastToRoom(
    channelPath: string,
    roomId: string,
    message: unknown,
    options?: { exceptConnectionIds?: string[] },
  ): Promise<void>;

  /**
   * Resolve the authenticated user id from a WebSocket handshake, using
   * alepha/security if it is registered. Browsers cannot set custom headers
   * on a WebSocket handshake, so credentials arrive as cookies or as a query
   * parameter (e.g. ?token= / ?api_key=) — both are carried through to the
   * security resolvers via the url + headers passed here.
   *
   * Public because platform entry points (e.g. the generated Cloudflare
   * worker entry) resolve this provider by string injection and call it
   * cross-module at runtime, outside of the module's type graph.
   *
   * Returns undefined when security is not registered or no credential
   * resolves to a user.
   */
  public async resolveUserId(handshake: {
    url: string;
    headers: Record<string, string | undefined>;
  }): Promise<string | undefined> {
    let security: { resolveUserFromServerRequest: Function } | undefined;
    try {
      security = this.alepha.inject("alepha.security.SecurityProvider") as any;
    } catch {
      return undefined;
    }

    await this.convertSessionCookie(handshake);

    if (!security) {
      return undefined;
    }

    const user = await security.resolveUserFromServerRequest({
      url: handshake.url,
      headers: handshake.headers,
    } as any);

    return user?.id;
  }

  /**
   * Turn the session cookie of a trusted handshake into an `Authorization`
   * header, which is the only credential the security resolvers read.
   */
  protected async convertSessionCookie(handshake: {
    url: string;
    headers: Record<string, string | undefined>;
  }): Promise<void> {
    // Browser WebSocket handshakes cannot carry an `Authorization` header — the encrypted
    // session cookie is their only credential. HTTP requests get the cookie→authorization
    // conversion from ServerAuthProvider's `server:request:before` hook; an upgrade bypasses that
    // pipeline, so the equivalent conversion runs here before the resolver chain (whose
    // resolvers only read `authorization`).
    //
    // Only for an upgrade from this host, or from an origin the CORS
    // configuration lists explicitly: the browser attaches the cookie to a
    // handshake from ANY page, so without this a page on another site opened
    // a socket as the user (cross-site WebSocket hijacking). A refused
    // conversion leaves the upgrade anonymous, and the endpoint's own
    // `secure` or `authorize` decides. An upgrade carrying its own
    // `Authorization` (a native or server client) has no ambient credential
    // and is untouched.
    if (
      !handshake.headers.authorization &&
      handshake.headers.cookie &&
      this.isTrustedHandshakeOrigin(handshake)
    ) {
      try {
        const auth = this.alepha.inject("alepha.server.ServerAuthProvider") as {
          accessTokenFromCookieHeader(
            header: string,
          ): Promise<string | undefined>;
        };
        const token = await auth.accessTokenFromCookieHeader(
          handshake.headers.cookie,
        );
        if (token) {
          handshake.headers.authorization = `Bearer ${token}`;
        }
      } catch {
        // No auth module registered — bearer-only apps keep working unchanged.
      }
    }
  }

  /**
   * Whether a handshake's `Origin` may carry the session cookie: this host,
   * or an origin listed explicitly in CORS. A missing `Origin` is refused,
   * since every browser sends one on a WebSocket handshake.
   */
  protected isTrustedHandshakeOrigin(handshake: {
    url: string;
    headers: Record<string, string | undefined>;
  }): boolean {
    let host = handshake.headers.host;
    if (!host) {
      try {
        host = new URL(handshake.url).host;
      } catch {
        host = undefined;
      }
    }
    return this.originPolicy.isTrustedOrigin(
      handshake.headers.origin,
      host ?? "",
    );
  }

  /**
   * Decide a handshake before any socket exists, and name the room it lands
   * in.
   *
   * Two ways in, chosen by the endpoint:
   *
   * - **`authorize`**: the endpoint's own hook decides. It is for a credential
   *   that names a machine rather than a person, so it never touches the
   *   security realm, and the room it returns REPLACES whatever the URL asked
   *   for. `undefined` is a refusal. A throw is not: it propagates, so the
   *   caller answers 503 rather than a 401 that a well-behaved machine reads
   *   as "your credential was revoked, stop retrying".
   * - otherwise **`resolveUserId`** plus `secure`: the session path, as it
   *   always was. A resolver failure is logged and read as anonymous, which
   *   is what the worker entry did before this method existed; on a `secure`
   *   endpoint anonymous is a refusal anyway.
   *
   * One method rather than two call sites agreeing, because the Node upgrade
   * and the generated Cloudflare worker entry both have to make exactly this
   * decision, and the worker entry reaches this provider by string injection,
   * where no type can hold the two in step.
   *
   * Public for the same reason {@link resolveUserId} is.
   */
  public async admit(
    endpoint: WebSocketAdmissionOptions | undefined,
    handshake: WebSocketHandshake,
  ): Promise<WebSocketAdmissionResult> {
    if (endpoint?.authorize) {
      const admission = await endpoint.authorize(handshake);
      if (!admission) {
        return { accepted: false };
      }
      return {
        accepted: true,
        userId: admission.userId,
        roomId: admission.roomId,
      };
    }

    if (endpoint?.use?.length) {
      return await this.admitThrough(endpoint.use, handshake);
    }

    let userId: string | undefined;
    try {
      userId = await this.resolveUserId(handshake);
    } catch (error) {
      this.alepha.log?.warn("Failed to resolve WebSocket user identity", error);
    }
    if (endpoint?.secure && !userId) {
      return { accepted: false };
    }
    return { accepted: true, userId };
  }

  /**
   * Run an endpoint's `use` middlewares on the upgrade request.
   *
   * The handshake stands in for the HTTP request (`alepha.http.request`),
   * which is where `$secure` looks for a credential and where it leaves the
   * user it resolved. A 401 or 403 from a middleware refuses the upgrade with
   * that status; anything else propagates, and the caller answers 503.
   */
  protected async admitThrough(
    use: readonly Middleware[],
    handshake: WebSocketHandshake,
  ): Promise<WebSocketAdmissionResult> {
    await this.convertSessionCookie(handshake);
    const request: { url: string; headers: Record<string, any>; user?: any } = {
      url: handshake.url,
      headers: handshake.headers,
    };
    try {
      await this.alepha.context.run(
        () => {
          this.alepha.store.set("alepha.http.request", request as any, {
            skipEvents: true,
          });
          return new PipelineHandler(async () => true, use).run();
        },
        handshake.signal ? { signal: handshake.signal } : {},
      );
    } catch (error) {
      if (
        error instanceof HttpError &&
        (error.status === 401 || error.status === 403)
      ) {
        return { accepted: false, status: error.status };
      }
      throw error;
    }
    return { accepted: true, userId: request.user?.id };
  }

  /**
   * Refuse an endpoint that declares both ways in.
   *
   * `authorize` decides on its own and `secure` asks the realm; one endpoint
   * with both would have to pick silently, and whichever it picked would be
   * a surprise to the author of the other. Refused where the endpoint is
   * registered, so the mistake fails the boot rather than the first client.
   */
  protected assertAdmissionOptions(
    options: WebSocketAdmissionOptions,
    path: string,
  ): void {
    const guarded = options.use?.some(
      (it: Middleware) => it[OPTIONS]?.meta?.[MIDDLEWARE_PROTECTED] === "true",
    );
    if (options.authorize && (options.secure || guarded)) {
      throw new AlephaError(
        `WebSocket endpoint ${path} declares both authorize and $secure. ` +
          "An endpoint has one way in: authorize decides the handshake itself, " +
          "$secure asks alepha/security. Keep one.",
      );
    }
  }
}
