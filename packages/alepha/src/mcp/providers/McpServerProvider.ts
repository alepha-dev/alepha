import { $inject, Alepha, AlephaError, SchemaValidationError } from "alepha";
import { $logger } from "alepha/logger";

import {
  McpError,
  McpInvalidParamsError,
  McpMethodNotFoundError,
  McpPromptNotFoundError,
  McpResourceNotFoundError,
  McpToolNotFoundError,
  McpToolOutputError,
  McpUnsupportedProtocolVersionError,
} from "../errors/McpError.ts";
import {
  createErrorResponse,
  createInternalError,
  createResponse,
  isLegacyProtocolVersion,
  LEGACY_PROTOCOL_VERSIONS,
  SUPPORTED_PROTOCOL_VERSIONS,
} from "../helpers/jsonrpc.ts";
import type {
  JsonRpcError,
  JsonRpcRequest,
  JsonRpcResponse,
  McpCacheHints,
  McpCapabilities,
  McpClientInfo,
  McpCompletionArgument,
  McpCompletionRef,
  McpCompletionResult,
  McpContent,
  McpContext,
  McpDiscoverResult,
  McpInitializeResult,
  McpPromptDescriptor,
  McpPromptGetResult,
  McpPromptMessage,
  McpRequestMeta,
  McpResourceContent,
  McpResourceDescriptor,
  McpResourceReadResult,
  McpResourceTemplateDescriptor,
  McpServerInfo,
  McpToolCallResult,
  McpToolDescriptor,
} from "../interfaces/McpTypes.ts";
import type { PromptPrimitive } from "../primitives/$prompt.ts";
import type { ResourcePrimitive } from "../primitives/$resource.ts";
import type { ResourceTemplatePrimitive } from "../primitives/$resourceTemplate.ts";
import type { ToolPrimitive } from "../primitives/$tool.ts";

// ---------------------------------------------------------------------------------------------------------------------

/**
 * Core MCP server provider that handles protocol messages.
 *
 * This provider maintains registries of tools, resources, and prompts,
 * and routes incoming JSON-RPC requests to the appropriate handlers.
 *
 * It is transport-agnostic - actual communication is handled by
 * transport providers like StreamableHttpMcpTransport.
 */
export class McpServerProvider {
  protected readonly log = $logger();
  protected readonly alepha = $inject(Alepha);

  protected readonly tools = new Map<string, ToolPrimitive<any>>();
  protected readonly resources = new Map<string, ResourcePrimitive>();
  protected readonly resourceTemplates = new Map<
    string,
    ResourceTemplatePrimitive<any>
  >();
  protected readonly prompts = new Map<string, PromptPrimitive<any>>();

  /**
   * Requests currently being handled, so `notifications/cancelled` can reach
   * them. Keyed by `clientKey:id` — see {@link McpContext.clientKey}.
   */
  protected readonly inFlight = new Map<string, AbortController>();

  /**
   * Server identity returned during `initialize`. Consumers may override
   * fields directly (e.g. `mcpServer.serverInfo = { name: "lore-mcp",
   * version: "0.20.3", description: "..." }`) — the `description` field
   * is supported per spec 2025-11-25 (minor change #2).
   */
  public serverInfo: McpServerInfo = {
    name: "alepha-mcp",
    version: "1.0.0",
  };

  /**
   * Maximum number of entries returned by one `tools/list`, `resources/list`,
   * `resources/templates/list` or `prompts/list` call. Beyond it the response
   * carries a `nextCursor` the client passes back to fetch the next page.
   *
   * The default is deliberately above what a typical server registers, so
   * turning pagination on changed nothing for anyone already shipping. Lower
   * it when the descriptor blob is what you are trying to keep out of the
   * model's context — that is the knob, not the default. `0` disables paging
   * and always returns everything.
   */
  public pageSize = 100;

  /**
   * Maximum number of candidates returned by one `completion/complete`. Beyond
   * it the response reports `hasMore: true` and the real `total`, so a picker
   * can tell the user to keep typing.
   */
  public completionLimit = 100;

  /**
   * The protocol revisions this server serves, highest preference first.
   *
   * **This list is the switch for the modern protocol.** The modern path
   * (2026-07-28: per-request `_meta`, `server/discover`, no handshake) is on
   * exactly when it holds a modern version, and off otherwise. There is no
   * separate flag, because a flag and a version list can disagree, and
   * advertising a revision the server does not serve is precisely that
   * disagreement.
   *
   * While the modern path is off, a request is always served as legacy and an
   * unsupported `MCP-Protocol-Version` gets a plain non-JSON-RPC 400: the
   * answer that makes a dual-era client fall back to `initialize`.
   *
   * ```ts
   * mcpServer.protocolVersions = [
   *   ...MODERN_PROTOCOL_VERSIONS,
   *   ...LEGACY_PROTOCOL_VERSIONS,
   * ];
   * ```
   */
  public protocolVersions: string[] = [...SUPPORTED_PROTOCOL_VERSIONS];

  /**
   * Caching hints on the `tools/list`, `prompts/list`, `resources/list` and
   * `resources/templates/list` results sent to a modern client (spec
   * 2026-07-28 `ttlMs` / `cacheScope`). Every page of a list carries the same
   * hints.
   *
   * `"public"` because the registries are filled once at start and every
   * caller gets the same list. Five minutes bounds how long a client keeps a
   * list from before a deploy: there is no `listChanged` notification to
   * invalidate it sooner. A server that filters a list per caller (by
   * overriding a list handler) must switch this to `"private"`, or a shared
   * cache may hand one user's list to another.
   */
  public listCache: McpCacheHints = { ttlMs: 300_000, cacheScope: "public" };

  /**
   * Caching hints on the `server/discover` result (spec 2026-07-28). Public
   * and five minutes, for the same reasons as {@link listCache}: versions and
   * capabilities are the same for every caller and change only with a deploy.
   */
  public discoverCache: McpCacheHints = {
    ttlMs: 300_000,
    cacheScope: "public",
  };

  // -----------------------------------------------------------------------------------------------------------------
  // Registration Methods
  // -----------------------------------------------------------------------------------------------------------------

  /**
   * Register a tool with the MCP server.
   */
  public registerTool(tool: ToolPrimitive<any>): void {
    this.log.trace(`Registering MCP tool: ${tool.name}`);
    this.assertUnregistered(this.tools, tool.name, "tool");
    this.tools.set(tool.name, tool);
  }

  /**
   * Register a resource with the MCP server.
   */
  public registerResource(resource: ResourcePrimitive): void {
    this.log.trace(`Registering MCP resource: ${resource.uri}`);
    this.assertUnregistered(this.resources, resource.uri, "resource");
    this.resources.set(resource.uri, resource);
  }

  /**
   * Register a resource template with the MCP server.
   */
  public registerResourceTemplate(
    template: ResourceTemplatePrimitive<any>,
  ): void {
    this.log.trace(
      `Registering MCP resource template: ${template.uriTemplate}`,
    );
    this.assertUnregistered(
      this.resourceTemplates,
      template.uriTemplate,
      "resource template",
    );
    this.resourceTemplates.set(template.uriTemplate, template);
  }

  /**
   * Register a prompt with the MCP server.
   */
  public registerPrompt(prompt: PromptPrimitive<any>): void {
    this.log.trace(`Registering MCP prompt: ${prompt.name}`);
    this.assertUnregistered(this.prompts, prompt.name, "prompt");
    this.prompts.set(prompt.name, prompt);
  }

  /**
   * Two primitives under one key used to be a silent overwrite: the second
   * class to register won and the first tool simply disappeared from the
   * list. The same name on two classes is a wiring mistake, and a boot-time
   * error is the only place it can be caught.
   */
  protected assertUnregistered(
    registry: Map<string, unknown>,
    key: string,
    kind: string,
  ): void {
    if (registry.has(key)) {
      throw new AlephaError(`MCP ${kind} '${key}' is registered twice`);
    }
  }

  // -----------------------------------------------------------------------------------------------------------------
  // Getters
  // -----------------------------------------------------------------------------------------------------------------

  /**
   * Get the server capabilities based on registered primitives.
   */
  public getCapabilities(): McpCapabilities {
    return {
      tools: this.tools.size > 0 ? {} : undefined,
      // Templates live under the same capability as concrete resources —
      // `resources/templates/list` is part of the resources surface, so a
      // server offering only templates still declares `resources`.
      resources:
        this.resources.size > 0 || this.resourceTemplates.size > 0
          ? {}
          : undefined,
      prompts: this.prompts.size > 0 ? {} : undefined,
      // Gated on a handler actually existing, the same way the three above are
      // gated on a non-empty registry. A `completions` capability backed by
      // nothing would have every client offering an autocomplete that always
      // comes back empty.
      completions: this.hasCompletions() ? {} : undefined,
    };
  }

  /**
   * Whether any prompt or resource template can answer `completion/complete`.
   */
  protected hasCompletions(): boolean {
    for (const prompt of this.prompts.values()) {
      if (prompt.hasCompletion()) return true;
    }
    for (const template of this.resourceTemplates.values()) {
      if (template.hasCompletion()) return true;
    }
    return false;
  }

  /**
   * Get all registered tools.
   */
  public getTools(): ToolPrimitive<any>[] {
    return Array.from(this.tools.values());
  }

  /**
   * Get all registered resources.
   */
  public getResources(): ResourcePrimitive[] {
    return Array.from(this.resources.values());
  }

  /**
   * Get all registered resource templates.
   */
  public getResourceTemplates(): ResourceTemplatePrimitive<any>[] {
    return Array.from(this.resourceTemplates.values());
  }

  /**
   * Get all registered prompts.
   */
  public getPrompts(): PromptPrimitive<any>[] {
    return Array.from(this.prompts.values());
  }

  /**
   * Get a tool by name.
   */
  public getTool(name: string): ToolPrimitive<any> | undefined {
    return this.tools.get(name);
  }

  /**
   * Get a resource by URI.
   */
  public getResource(uri: string): ResourcePrimitive | undefined {
    return this.resources.get(uri);
  }

  /**
   * Get a prompt by name.
   */
  public getPrompt(name: string): PromptPrimitive<any> | undefined {
    return this.prompts.get(name);
  }

  // -----------------------------------------------------------------------------------------------------------------
  // Protocol Eras
  // -----------------------------------------------------------------------------------------------------------------

  /**
   * Whether the modern protocol is on: {@link protocolVersions} holds at least
   * one modern version.
   */
  public isModernEnabled(): boolean {
    return this.protocolVersions.some((v) => !isLegacyProtocolVersion(v));
  }

  /**
   * {@link protocolVersions}, modern versions first, each era in its own order.
   * What `server/discover` and `-32022` advertise.
   */
  public getSupportedVersions(): string[] {
    return [
      ...this.protocolVersions.filter((v) => !isLegacyProtocolVersion(v)),
      ...this.protocolVersions.filter((v) => isLegacyProtocolVersion(v)),
    ];
  }

  /**
   * Decide which era a request belongs to, from the request alone.
   *
   * The spec lets a dual-era server choose "from how the client opens", but
   * this server keeps no session and this provider is a process-global
   * singleton: it cannot remember who sent `initialize`. So the rule is
   * applied to each request on its own:
   *
   * - **Modern** iff `_meta["io.modelcontextprotocol/protocolVersion"]` or the
   *   `MCP-Protocol-Version` header names a version outside
   *   `LEGACY_PROTOCOL_VERSIONS`. An unknown future version is modern too, and
   *   gets the modern `-32022`.
   * - **Legacy** otherwise, and `initialize` always: served exactly as before.
   *
   * Returns the request's modern metadata, or `undefined` for a legacy
   * request. Always `undefined` while the modern path is off
   * ({@link isModernEnabled}): modern `_meta` is then ignored, as it was
   * before this server knew about it.
   *
   * Public because a transport needs the answer before it dispatches: an HTTP
   * status is decided before a response stream opens.
   */
  public resolveModernRequest(
    request: JsonRpcRequest,
    headers?: Record<string, string | string[] | undefined>,
  ): McpRequestMeta | undefined {
    if (request.method === "initialize" || !this.isModernEnabled()) {
      return undefined;
    }

    const meta = this.requestMeta(request);
    const metaVersion = meta?.["io.modelcontextprotocol/protocolVersion"];
    const headerRaw = headers?.["mcp-protocol-version"];
    const headerVersion = Array.isArray(headerRaw) ? headerRaw[0] : headerRaw;

    const protocolVersion = [metaVersion, headerVersion].find(
      (v): v is string =>
        typeof v === "string" && v.length > 0 && !isLegacyProtocolVersion(v),
    );
    if (protocolVersion === undefined) {
      return undefined;
    }

    const clientInfo = meta?.["io.modelcontextprotocol/clientInfo"];
    const clientCapabilities =
      meta?.["io.modelcontextprotocol/clientCapabilities"];
    return {
      protocolVersion,
      clientInfo: this.isPlainObject(clientInfo)
        ? (clientInfo as unknown as McpClientInfo)
        : undefined,
      clientCapabilities: this.isPlainObject(clientCapabilities)
        ? clientCapabilities
        : {},
    };
  }

  /**
   * Why a modern request cannot be served at all, before it is routed: today,
   * a protocol version outside {@link protocolVersions}. `undefined` when it
   * can be.
   *
   * Public for the same reason as {@link resolveModernRequest}: the HTTP
   * transport answers these with a 400, and has to know before it opens a
   * response stream.
   */
  public checkModernRequest(modern: McpRequestMeta): McpError | undefined {
    if (!this.protocolVersions.includes(modern.protocolVersion)) {
      return new McpUnsupportedProtocolVersionError(
        modern.protocolVersion,
        this.getSupportedVersions(),
      );
    }
    return undefined;
  }

  /**
   * Whether this server implements a request method in the given era.
   *
   * 2026-07-28 removed `ping` (and `initialize`, which is legacy by
   * definition) and added `server/discover`; everything else is shared. A
   * modern request for a method outside this answers `-32601`, which the HTTP
   * transport sends as 404 and decides before a response stream opens.
   *
   * A subclass that adds a method to {@link handleRequest} adds it here too.
   */
  public handlesMethod(method: string, modern: boolean): boolean {
    switch (method) {
      case "tools/list":
      case "tools/call":
      case "resources/list":
      case "resources/templates/list":
      case "resources/read":
      case "prompts/list":
      case "prompts/get":
      case "completion/complete":
        return true;
      case "server/discover":
        return modern;
      case "initialize":
      case "ping":
        return !modern;
      default:
        return false;
    }
  }

  /**
   * A request's `params._meta`, when it is an object.
   */
  protected requestMeta(
    request: JsonRpcRequest,
  ): Record<string, unknown> | undefined {
    const meta = request.params?._meta;
    return this.isPlainObject(meta) ? meta : undefined;
  }

  protected isPlainObject(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === "object" && !Array.isArray(value);
  }

  // -----------------------------------------------------------------------------------------------------------------
  // Message Handling
  // -----------------------------------------------------------------------------------------------------------------

  /**
   * Handle an incoming JSON-RPC request.
   *
   * @param request - The parsed JSON-RPC request
   * @param context - Optional context from the transport layer (headers, auth, etc.)
   * @returns The JSON-RPC response, or null for notifications
   */
  public async handleMessage(
    request: JsonRpcRequest,
    context?: McpContext,
  ): Promise<JsonRpcResponse | null> {
    const id = request.id;

    // Notifications have no id and expect no response
    if (id === undefined) {
      await this.handleNotification(request, context);
      return null;
    }

    // Decided here, from the request, and written over whatever the caller
    // put in the context: on a legacy request all three stay undefined.
    const modern = this.resolveModernRequest(request, context?.headers);
    if (modern) {
      const rejection = this.checkModernRequest(modern);
      if (rejection) {
        return createErrorResponse(id, this.toJsonRpcError(rejection));
      }
    }

    const key = this.inFlightKey(context?.clientKey, id);
    const controller = new AbortController();
    this.inFlight.set(key, controller);

    try {
      const result = await this.handleRequest(request, {
        ...context,
        signal: controller.signal,
        protocolVersion: modern?.protocolVersion,
        clientInfo: modern?.clientInfo,
        clientCapabilities: modern?.clientCapabilities,
      });
      // The client has withdrawn the request. Answering it now would be a
      // response to a question nobody is listening for any more — and per
      // spec the cancelled request's response MUST NOT be sent.
      if (controller.signal.aborted) {
        return null;
      }
      return createResponse(
        id,
        modern ? this.toModernResult(request, result) : result,
      );
    } catch (error) {
      if (controller.signal.aborted) {
        this.log.debug("MCP request aborted by client", { id });
        return null;
      }
      this.log.error("MCP request failed", error);
      // Preserve error code from McpError instances
      if (error instanceof McpError) {
        return createErrorResponse(id, this.toJsonRpcError(error));
      }
      // A schema failure is the CALLER's fault, so it is -32602 Invalid
      // params, not -32603 Internal error. Prompts and resources validate
      // their arguments here and every failure used to surface as an internal
      // error, telling the model nothing it could act on. (Tools take a
      // different route: SEP-1303 returns them as tool execution errors so
      // the model can self-correct.)
      if (error instanceof SchemaValidationError) {
        const invalid = new McpInvalidParamsError(
          `Invalid params: ${error.value?.message ?? error.message}` +
            (error.value?.path ? ` at ${error.value.path}` : ""),
        );
        return createErrorResponse(id, {
          code: invalid.code,
          message: invalid.message,
        });
      }
      return createErrorResponse(
        id,
        createInternalError((error as Error).message),
      );
    } finally {
      this.inFlight.delete(key);
    }
  }

  /**
   * Shape a handler's result for a modern request (spec 2026-07-28): the one
   * place the result envelope is decided, so handlers stay era-blind.
   *
   * - `resultType: "complete"` on every result, a tool's `isError` result
   *   included (it is a result, not a JSON-RPC error; errors carry none).
   * - `ttlMs` and `cacheScope` on the six cacheable results.
   * - `_meta["io.modelcontextprotocol/serverInfo"]`, since there is no
   *   `initialize` result left to carry the server's identity. Merged into a
   *   `_meta` the result already has (a raw tool result may bring one), never
   *   replacing it.
   *
   * Never applied to a legacy request, whose result stays exactly what it
   * always was.
   */
  protected toModernResult(
    request: JsonRpcRequest,
    result: unknown,
  ): Record<string, unknown> {
    const object = this.isPlainObject(result) ? result : {};
    const meta = this.isPlainObject(object._meta) ? object._meta : {};
    return {
      ...object,
      resultType: "complete",
      ...this.cacheHintsFor(request),
      _meta: { ...meta, "io.modelcontextprotocol/serverInfo": this.serverInfo },
    };
  }

  /**
   * The caching hints a modern result of this request carries, or `undefined`
   * when its method is not cacheable.
   */
  protected cacheHintsFor(request: JsonRpcRequest): McpCacheHints | undefined {
    switch (request.method) {
      case "server/discover":
        return this.normalizeCacheHints(this.discoverCache);
      case "tools/list":
      case "prompts/list":
      case "resources/list":
      case "resources/templates/list":
        return this.normalizeCacheHints(this.listCache);
      case "resources/read": {
        const uri = request.params?.uri;
        const hints =
          typeof uri === "string"
            ? this.findReadable(uri)?.readCache
            : undefined;
        return this.normalizeCacheHints(
          hints ?? { ttlMs: 0, cacheScope: "private" },
        );
      }
      default:
        return undefined;
    }
  }

  /**
   * Hints as the spec requires them on the wire: an integer `ttlMs >= 0`, and
   * a scope that is `"private"` unless it says `"public"`. A typo fails closed.
   */
  protected normalizeCacheHints(hints: McpCacheHints): McpCacheHints {
    const ttl = Number(hints.ttlMs);
    return {
      ttlMs: Number.isFinite(ttl) && ttl > 0 ? Math.floor(ttl) : 0,
      cacheScope: hints.cacheScope === "public" ? "public" : "private",
    };
  }

  /**
   * The primitive a `resources/read` of this URI is served by: the concrete
   * resource when there is one, otherwise the first template that matches.
   * The same precedence {@link handleResourcesRead} applies.
   */
  protected findReadable(
    uri: string,
  ): ResourcePrimitive | ResourceTemplatePrimitive<any> | undefined {
    const resource = this.resources.get(uri);
    if (resource) {
      return resource;
    }
    for (const template of this.resourceTemplates.values()) {
      if (template.match(uri)) {
        return template;
      }
    }
    return undefined;
  }

  /**
   * The JSON-RPC error an {@link McpError} is sent as. `data` only when the
   * error carries some, so every error that never had it keeps its exact
   * shape on the wire.
   */
  protected toJsonRpcError(error: McpError): JsonRpcError {
    return {
      code: error.code,
      message: error.message,
      ...(error.data !== undefined ? { data: error.data } : {}),
    };
  }

  // -----------------------------------------------------------------------------------------------------------------
  // Cancellation
  // -----------------------------------------------------------------------------------------------------------------

  protected inFlightKey(
    clientKey: string | undefined,
    id: string | number,
  ): string {
    return `${clientKey ?? ""}:${id}`;
  }

  /**
   * Abandon an in-flight request: its handler's {@link McpContext.signal} is
   * aborted and its response will be suppressed.
   *
   * Deliberately public and trigger-agnostic. `notifications/cancelled` is how
   * a 2025-11-25 client asks for this; under 2026-07-28 the trigger becomes
   * closing the SSE response stream instead. The plumbing is the same either
   * way, so a transport can call this from whichever signal it observes.
   *
   * Returns whether a matching request was actually running — an unknown id is
   * normal, not an error: the request may have completed just before the
   * cancellation arrived.
   */
  public cancelRequest(id: string | number, clientKey?: string): boolean {
    const controller = this.inFlight.get(this.inFlightKey(clientKey, id));
    controller?.abort();
    return !!controller;
  }

  /**
   * Handle a JSON-RPC request that expects a response.
   */
  protected async handleRequest(
    request: JsonRpcRequest,
    context?: McpContext,
  ): Promise<unknown> {
    const { method, params = {} } = request;

    // A method is known per era: `server/discover` only to a modern request
    // (a legacy one, or any request while the modern path is off, gets -32601,
    // exactly the answer a dual-era stdio client reads as "this server is
    // legacy"), `ping` only to a legacy one.
    if (!this.handlesMethod(method, context?.protocolVersion !== undefined)) {
      throw new McpMethodNotFoundError(method);
    }

    switch (method) {
      case "initialize":
        return this.handleInitialize(params);
      case "server/discover":
        return this.handleDiscover();
      case "ping":
        return this.handlePing();
      case "tools/list":
        return this.handleToolsList(params);
      case "tools/call":
        return this.handleToolsCall(params, context);
      case "resources/list":
        return this.handleResourcesList(params);
      case "resources/templates/list":
        return this.handleResourceTemplatesList(params);
      case "resources/read":
        return this.handleResourcesRead(params, context);
      case "prompts/list":
        return this.handlePromptsList(params);
      case "prompts/get":
        return this.handlePromptsGet(params, context);
      case "completion/complete":
        return this.handleCompletionComplete(params, context);
      default:
        throw new McpMethodNotFoundError(method);
    }
  }

  /**
   * Handle a notification (no response expected).
   */
  protected async handleNotification(
    request: JsonRpcRequest,
    context?: McpContext,
  ): Promise<void> {
    const { method } = request;

    switch (method) {
      case "notifications/initialized":
        this.log.debug("MCP client initialized");
        break;
      case "notifications/cancelled": {
        const requestId = request.params?.requestId as string | number;
        const found =
          requestId !== undefined &&
          this.cancelRequest(requestId, context?.clientKey);
        this.log.debug("MCP request cancelled", { requestId, found });
        break;
      }
      default:
        this.log.debug(`Unknown MCP notification: ${method}`);
    }
  }

  // -----------------------------------------------------------------------------------------------------------------
  // Protocol Handlers
  // -----------------------------------------------------------------------------------------------------------------

  protected handleInitialize(
    params: Record<string, unknown>,
  ): McpInitializeResult {
    const requested = params.protocolVersion;
    // Echo the client's version when it is a legacy one, otherwise reply with
    // our preferred legacy version. The client can then decide to retry,
    // downgrade, or disconnect.
    //
    // From the LEGACY list only, never from `protocolVersions`: `initialize`
    // is how a legacy client opens, and once a modern version is served,
    // echoing it here would tell that client it negotiated a revision whose
    // semantics it does not speak.
    const negotiated: string = isLegacyProtocolVersion(requested)
      ? (requested as string)
      : LEGACY_PROTOCOL_VERSIONS[0];

    this.log.info("MCP client initializing", {
      clientInfo: params.clientInfo,
      requestedProtocolVersion: requested,
      negotiatedProtocolVersion: negotiated,
    });

    // The negotiated version is deliberately NOT stored on this provider.
    // It was, and the transport validated the `MCP-Protocol-Version` header
    // against it — but the provider is a process-global singleton, so client
    // B's `initialize` changed what client A was checked against, and a fresh
    // Worker isolate reset it. The transport now validates against the
    // SUPPORTED set instead; see its comment.
    return {
      protocolVersion: negotiated,
      capabilities: this.getCapabilities(),
      serverInfo: this.serverInfo,
    };
  }

  protected handlePing(): Record<string, never> {
    return {};
  }

  /**
   * `server/discover` (spec 2026-07-28): the versions this server serves,
   * modern first, and its capabilities. Every server MUST implement it; a
   * client may call it before anything else, and a dual-era stdio client uses
   * it as its probe.
   */
  protected handleDiscover(): McpDiscoverResult {
    return {
      supportedVersions: this.getSupportedVersions(),
      capabilities: this.getCapabilities(),
    };
  }

  // -----------------------------------------------------------------------------------------------------------------
  // Pagination
  // -----------------------------------------------------------------------------------------------------------------

  /**
   * Encode a list position as an opaque cursor.
   *
   * Opaque is the contract: the client passes it back verbatim and never
   * constructs one. The `kind` tag is what stops a `tools/list` cursor from
   * being replayed against `prompts/list`, where the same offset addresses a
   * completely different registry.
   *
   * A positional cursor is stable because the registries are `Map`s populated
   * once at container start, so iteration order is registration order and does
   * not change between pages.
   */
  protected encodeCursor(kind: string, offset: number): string {
    return btoa(JSON.stringify({ k: kind, o: offset }));
  }

  /**
   * Resolve a client-supplied cursor back to an offset. An absent cursor is
   * page one; anything unrecognized is `-32602`, never a silent reset to page
   * one — a client looping on a cursor it mangled would otherwise never
   * terminate.
   */
  protected decodeCursor(kind: string, cursor: unknown): number {
    if (cursor === undefined || cursor === null) {
      return 0;
    }
    if (typeof cursor === "string") {
      try {
        const parsed = JSON.parse(atob(cursor));
        if (parsed?.k === kind && Number.isInteger(parsed.o) && parsed.o >= 0) {
          return parsed.o;
        }
      } catch {
        // Fall through to the single rejection below.
      }
    }
    throw new McpInvalidParamsError("Invalid params: invalid cursor");
  }

  /**
   * Slice one page out of a registry listing, and mint the cursor for the next.
   */
  protected paginateList<T>(
    kind: string,
    all: T[],
    params: Record<string, unknown>,
  ): { page: T[]; nextCursor?: string } {
    const offset = this.decodeCursor(kind, params.cursor);
    if (this.pageSize <= 0) {
      return { page: all.slice(offset) };
    }
    const page = all.slice(offset, offset + this.pageSize);
    const next = offset + page.length;
    return {
      page,
      nextCursor: next < all.length ? this.encodeCursor(kind, next) : undefined,
    };
  }

  /**
   * Read a required string out of a request's `params`.
   *
   * Without this, `params.name as string` on an absent field flows into the
   * registry lookup and comes back as "Unknown tool: undefined" — a not-found
   * error for a tool the caller never named. A missing required field is
   * `-32602 Invalid params`, and the message says which field.
   */
  protected requireStringParam(
    params: Record<string, unknown>,
    key: string,
  ): string {
    const value = params[key];
    if (typeof value !== "string" || value.length === 0) {
      throw new McpInvalidParamsError(
        `Invalid params: missing required string "${key}"`,
      );
    }
    return value;
  }

  protected handleToolsList(params: Record<string, unknown>): {
    tools: McpToolDescriptor[];
    nextCursor?: string;
  } {
    const { page, nextCursor } = this.paginateList(
      "tools",
      Array.from(this.tools.values()),
      params,
    );
    return { tools: page.map((t) => t.toDescriptor()), nextCursor };
  }

  protected async handleToolsCall(
    params: Record<string, unknown>,
    context?: McpContext,
  ): Promise<McpToolCallResult> {
    const name = this.requireStringParam(params, "name");
    const args = (params.arguments ?? {}) as Record<string, unknown>;

    const tool = this.tools.get(name);
    if (!tool) {
      // McpToolNotFoundError is intentionally a JSON-RPC protocol error,
      // not a tool execution error — see SEP-1303 (only validation/runtime
      // failures of an existing tool are reported via isError: true).
      throw new McpToolNotFoundError(name);
    }

    try {
      const result = await tool.execute(args, context);

      // A tool WITHOUT an output schema may return raw MCP content blocks
      // (e.g. an `image` block) instead of JSON — used for binary payloads
      // like attachment previews. Recognized by the CallToolResult shape
      // (`{ content: McpContent[] }`); passed through verbatim. Tools that
      // declare an output schema always go through the structured path
      // below, so a JSON result that happens to carry a `content` array is
      // never mistaken for raw content.
      if (!tool.hasOutputSchema()) {
        const raw = this.asRawToolContent(result);
        if (raw) {
          return raw;
        }
      }

      const callResult: McpToolCallResult = {
        content: [
          {
            type: "text",
            text:
              typeof result === "string"
                ? result
                : JSON.stringify(result ?? null),
          },
        ],
      };

      // Spec 2025-06-18: when the tool declares an outputSchema, the server
      // MUST populate `structuredContent` with the validated result. The
      // text-stringified `content` block remains as a back-compat fallback,
      // and carries the bare value whether or not the envelope wraps it.
      //
      // The tool builds the envelope, because it is the same tool that
      // decides whether the advertised schema wraps: `structuredContent` has
      // to be an object, so a non-object result travels as `{ result }`.
      const structured = tool.toStructuredContent(result);
      if (structured !== undefined) {
        callResult.structuredContent = structured;
      }

      return callResult;
    } catch (error) {
      // Not everything that escapes a tool is the model's problem. An McpError
      // carries a JSON-RPC code precisely because it is NOT self-correctable:
      // McpToolOutputError (the tool broke its own output contract),
      // McpUnauthorizedError / McpForbiddenError (the caller may not do this).
      // Flattening those into `isError: true` text discarded the code and told
      // the model to try again at something it can never fix. Rethrowing lets
      // handleMessage map them to real JSON-RPC errors.
      if (error instanceof McpError) {
        if (error instanceof McpToolOutputError) {
          this.log.error(
            `MCP tool "${name}" returned a value violating its own output schema`,
            error,
          );
        }
        throw error;
      }

      // Spec 2025-11-25 / SEP-1303: input-validation failures (and other
      // tool-runtime errors) are returned as Tool Execution Errors, not
      // JSON-RPC protocol errors, so the model can self-correct.
      // For Zod validation errors we surface the failing path so the
      // model knows which argument was malformed. Only INPUT decoding can
      // reach here — the output encode throws McpToolOutputError, handled
      // above.
      if (error instanceof SchemaValidationError) {
        const path = error.value?.path || "/";
        const message = error.value?.message || error.message;
        return {
          content: [
            {
              type: "text",
              text: `Validation error at ${path}: ${message}`,
            },
          ],
          structuredContent: {
            errors: [{ path, message }],
          },
          isError: true,
        };
      }

      // Log before answering. The result below carries `error.message` and
      // nothing else — no `cause`, no stack — because the framework cannot
      // know who is on the other end of a tool call, and a driver error can
      // carry SQL text, column names and connection details. That is the
      // right payload for the model and a dead end for the operator: a tool
      // that failed once and succeeded on retry left no trail at all to say
      // what broke. The log is operator-only, so it can hold the whole chain
      // at no disclosure cost.
      this.log.error(`MCP tool "${name}" failed`, error as Error);

      return {
        content: [
          {
            type: "text",
            text: `Error: ${(error as Error).message}`,
          },
        ],
        isError: true,
      };
    }
  }

  /**
   * Recognize a tool handler's return value as a pre-built MCP tool result —
   * i.e. it already carries a `content` array of content blocks (text, image,
   * audio, resource, resource_link). Returns the normalized
   * {@link McpToolCallResult} when matched, or `undefined` to fall back to the
   * default JSON/text encoding. Only ever consulted for tools that did NOT
   * declare an output schema (see {@link handleToolCall}).
   */
  protected asRawToolContent(result: unknown): McpToolCallResult | undefined {
    if (!result || typeof result !== "object") {
      return undefined;
    }
    const candidate = result as {
      content?: unknown;
      isError?: unknown;
      _meta?: unknown;
    };
    if (!Array.isArray(candidate.content) || candidate.content.length === 0) {
      return undefined;
    }
    const allBlocks = candidate.content.every(
      (block): block is McpContent =>
        !!block &&
        typeof block === "object" &&
        typeof (block as { type?: unknown }).type === "string",
    );
    if (!allBlocks) {
      return undefined;
    }
    return {
      content: candidate.content as McpContent[],
      isError:
        typeof candidate.isError === "boolean" ? candidate.isError : undefined,
      _meta:
        candidate._meta && typeof candidate._meta === "object"
          ? (candidate._meta as Record<string, unknown>)
          : undefined,
    };
  }

  protected handleResourcesList(params: Record<string, unknown>): {
    resources: McpResourceDescriptor[];
    nextCursor?: string;
  } {
    const { page, nextCursor } = this.paginateList(
      "resources",
      Array.from(this.resources.values()),
      params,
    );
    return { resources: page.map((r) => r.toDescriptor()), nextCursor };
  }

  protected handleResourceTemplatesList(params: Record<string, unknown>): {
    resourceTemplates: McpResourceTemplateDescriptor[];
    nextCursor?: string;
  } {
    const { page, nextCursor } = this.paginateList(
      "resourceTemplates",
      Array.from(this.resourceTemplates.values()),
      params,
    );
    return {
      resourceTemplates: page.map((t) => t.toDescriptor()),
      nextCursor,
    };
  }

  protected async handleResourcesRead(
    params: Record<string, unknown>,
    context?: McpContext,
  ): Promise<McpResourceReadResult> {
    const uri = this.requireStringParam(params, "uri");

    // A concrete resource always wins over a template that happens to match
    // its URI. Registering `db://users/me` alongside `db://users/{id}` is a
    // deliberate special case, and the special case is the more specific one.
    const resource = this.resources.get(uri);
    if (resource) {
      return this.toReadResult(
        uri,
        resource.mimeType,
        await resource.read(context),
      );
    }

    for (const template of this.resourceTemplates.values()) {
      const variables = template.match(uri);
      if (!variables) {
        continue;
      }
      const content = await template.read(uri, variables, context);
      // A template can match the shape of a URI and still have nothing at it
      // — `folio://3/999` is well-formed and absent. Returning undefined is
      // how a handler says so without inventing empty content.
      if (content === undefined) {
        break;
      }
      return this.toReadResult(uri, template.mimeType, content);
    }

    throw new McpResourceNotFoundError(uri);
  }

  /**
   * Shape a handler's {@link ResourceContent} into the wire result.
   */
  protected toReadResult(
    uri: string,
    mimeType: string,
    content: { text?: string; blob?: Uint8Array },
  ): McpResourceReadResult {
    const resourceContent: McpResourceContent = { uri, mimeType };

    if (content.text !== undefined) {
      resourceContent.text = content.text;
    }

    if (content.blob !== undefined) {
      // Convert binary to base64 for transport
      resourceContent.blob = Buffer.from(content.blob).toString("base64");
    }

    return { contents: [resourceContent] };
  }

  /**
   * Argument autocompletion for a prompt argument or a resource template's URI
   * variable.
   */
  protected async handleCompletionComplete(
    params: Record<string, unknown>,
    context?: McpContext,
  ): Promise<McpCompletionResult> {
    const ref = params.ref as McpCompletionRef | undefined;
    const argument = params.argument as McpCompletionArgument | undefined;

    if (!argument || typeof argument.name !== "string") {
      throw new McpInvalidParamsError(
        'Invalid params: missing required "argument.name"',
      );
    }

    // Already-filled arguments, so a completion can narrow on them
    // (spec 2025-06-18+). Absent from older clients.
    const filled = (params.context as { arguments?: Record<string, string> })
      ?.arguments;

    const args = {
      argument: { name: argument.name, value: argument.value ?? "" },
      arguments: filled,
      context,
    };

    let candidates: string[];
    if (ref?.type === "ref/prompt") {
      const prompt = this.prompts.get(ref.name);
      if (!prompt) {
        throw new McpPromptNotFoundError(ref.name);
      }
      candidates = await prompt.complete(args);
    } else if (ref?.type === "ref/resource") {
      const template = this.resourceTemplates.get(ref.uri);
      if (!template) {
        throw new McpResourceNotFoundError(ref.uri);
      }
      candidates = await template.complete(args);
    } else {
      throw new McpInvalidParamsError(
        'Invalid params: "ref" must be { type: "ref/prompt", name } or { type: "ref/resource", uri }',
      );
    }

    // A primitive without a `complete` handler answers with an empty list
    // rather than an error: the reference is valid, the server just has
    // nothing to suggest.
    const values = candidates.slice(0, this.completionLimit);
    return {
      completion: {
        values,
        total: candidates.length,
        hasMore: candidates.length > values.length,
      },
    };
  }

  protected handlePromptsList(params: Record<string, unknown>): {
    prompts: McpPromptDescriptor[];
    nextCursor?: string;
  } {
    const { page, nextCursor } = this.paginateList(
      "prompts",
      Array.from(this.prompts.values()),
      params,
    );
    return { prompts: page.map((p) => p.toDescriptor()), nextCursor };
  }

  protected async handlePromptsGet(
    params: Record<string, unknown>,
    context?: McpContext,
  ): Promise<McpPromptGetResult> {
    const name = this.requireStringParam(params, "name");
    const args = (params.arguments ?? {}) as Record<string, string>;

    const prompt = this.prompts.get(name);
    if (!prompt) {
      throw new McpPromptNotFoundError(name);
    }

    const messages = await prompt.get(args, context);

    return {
      description: prompt.description,
      messages: messages.flatMap((msg) =>
        // On the wire a message carries exactly one content block, so a
        // handler that returns several becomes several messages, in order,
        // all with the same role.
        (Array.isArray(msg.content) ? msg.content : [msg.content]).map(
          (block): McpPromptMessage => ({
            role: msg.role,
            content:
              typeof block === "string" ? { type: "text", text: block } : block,
          }),
        ),
      ),
    };
  }
}
