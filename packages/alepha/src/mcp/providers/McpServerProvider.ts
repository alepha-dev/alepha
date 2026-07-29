import { $inject, Alepha, SchemaValidationError } from "alepha";
import { $logger } from "alepha/logger";
import {
  McpError,
  McpInvalidParamsError,
  McpMethodNotFoundError,
  McpPromptNotFoundError,
  McpResourceNotFoundError,
  McpToolNotFoundError,
} from "../errors/McpError.ts";
import {
  createErrorResponse,
  createInternalError,
  createResponse,
  isSupportedProtocolVersion,
  MCP_PROTOCOL_VERSION,
  SUPPORTED_PROTOCOL_VERSIONS,
} from "../helpers/jsonrpc.ts";
import type {
  JsonRpcRequest,
  JsonRpcResponse,
  McpCapabilities,
  McpContent,
  McpContext,
  McpInitializeResult,
  McpPromptDescriptor,
  McpPromptGetResult,
  McpPromptMessage,
  McpResourceContent,
  McpResourceDescriptor,
  McpResourceReadResult,
  McpServerInfo,
  McpToolCallResult,
  McpToolDescriptor,
} from "../interfaces/McpTypes.ts";
import type { PromptPrimitive } from "../primitives/$prompt.ts";
import type { ResourcePrimitive } from "../primitives/$resource.ts";
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
  protected readonly prompts = new Map<string, PromptPrimitive<any>>();

  /**
   * Protocol version negotiated with the client during `initialize`.
   * Used by transports to validate the `MCP-Protocol-Version` header on
   * subsequent HTTP requests (per spec 2025-06-18+).
   */
  public negotiatedVersion: string = MCP_PROTOCOL_VERSION;

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

  // -----------------------------------------------------------------------------------------------------------------
  // Registration Methods
  // -----------------------------------------------------------------------------------------------------------------

  /**
   * Register a tool with the MCP server.
   */
  public registerTool(tool: ToolPrimitive<any>): void {
    this.log.trace(`Registering MCP tool: ${tool.name}`);
    this.tools.set(tool.name, tool);
  }

  /**
   * Register a resource with the MCP server.
   */
  public registerResource(resource: ResourcePrimitive): void {
    this.log.trace(`Registering MCP resource: ${resource.uri}`);
    this.resources.set(resource.uri, resource);
  }

  /**
   * Register a prompt with the MCP server.
   */
  public registerPrompt(prompt: PromptPrimitive<any>): void {
    this.log.trace(`Registering MCP prompt: ${prompt.name}`);
    this.prompts.set(prompt.name, prompt);
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
      resources: this.resources.size > 0 ? {} : undefined,
      prompts: this.prompts.size > 0 ? {} : undefined,
    };
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
      await this.handleNotification(request);
      return null;
    }

    try {
      const result = await this.handleRequest(request, context);
      return createResponse(id, result);
    } catch (error) {
      this.log.error("MCP request failed", error);
      // Preserve error code from McpError instances
      if (error instanceof McpError) {
        return createErrorResponse(id, {
          code: error.code,
          message: error.message,
        });
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
    }
  }

  /**
   * Handle a JSON-RPC request that expects a response.
   */
  protected async handleRequest(
    request: JsonRpcRequest,
    context?: McpContext,
  ): Promise<unknown> {
    const { method, params = {} } = request;

    switch (method) {
      case "initialize":
        return this.handleInitialize(params);
      case "ping":
        return this.handlePing();
      case "tools/list":
        return this.handleToolsList();
      case "tools/call":
        return this.handleToolsCall(params, context);
      case "resources/list":
        return this.handleResourcesList();
      case "resources/read":
        return this.handleResourcesRead(params, context);
      case "prompts/list":
        return this.handlePromptsList();
      case "prompts/get":
        return this.handlePromptsGet(params, context);
      default:
        throw new McpMethodNotFoundError(method);
    }
  }

  /**
   * Handle a notification (no response expected).
   */
  protected async handleNotification(request: JsonRpcRequest): Promise<void> {
    const { method } = request;

    switch (method) {
      case "notifications/initialized":
        this.log.debug("MCP client initialized");
        break;
      case "notifications/cancelled":
        this.log.debug("MCP request cancelled", request.params);
        break;
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
    // Echo the client's version when supported, otherwise reply with our
    // preferred version (highest entry in SUPPORTED_PROTOCOL_VERSIONS).
    // The client can then decide to retry, downgrade, or disconnect.
    const negotiated = isSupportedProtocolVersion(requested)
      ? requested
      : SUPPORTED_PROTOCOL_VERSIONS[0];

    this.log.info("MCP client initializing", {
      clientInfo: params.clientInfo,
      requestedProtocolVersion: requested,
      negotiatedProtocolVersion: negotiated,
    });

    this.negotiatedVersion = negotiated;

    return {
      protocolVersion: negotiated,
      capabilities: this.getCapabilities(),
      serverInfo: this.serverInfo,
    };
  }

  protected handlePing(): Record<string, never> {
    return {};
  }

  protected handleToolsList(): { tools: McpToolDescriptor[] } {
    return {
      tools: Array.from(this.tools.values()).map((t) => t.toDescriptor()),
    };
  }

  protected async handleToolsCall(
    params: Record<string, unknown>,
    context?: McpContext,
  ): Promise<McpToolCallResult> {
    const name = params.name as string;
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
      // text-stringified `content` block remains as a back-compat fallback.
      if (tool.hasOutputSchema() && result !== undefined) {
        callResult.structuredContent = result;
      }

      return callResult;
    } catch (error) {
      // Spec 2025-11-25 / SEP-1303: input-validation failures (and other
      // tool-runtime errors) are returned as Tool Execution Errors, not
      // JSON-RPC protocol errors, so the model can self-correct.
      // For Zod validation errors we surface the failing path so the
      // model knows which argument was malformed.
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

  protected handleResourcesList(): { resources: McpResourceDescriptor[] } {
    return {
      resources: Array.from(this.resources.values()).map((r) =>
        r.toDescriptor(),
      ),
    };
  }

  protected async handleResourcesRead(
    params: Record<string, unknown>,
    context?: McpContext,
  ): Promise<McpResourceReadResult> {
    const uri = params.uri as string;

    const resource = this.resources.get(uri);
    if (!resource) {
      throw new McpResourceNotFoundError(uri);
    }

    const content = await resource.read(context);

    const resourceContent: McpResourceContent = {
      uri,
      mimeType: resource.mimeType,
    };

    if (content.text !== undefined) {
      resourceContent.text = content.text;
    }

    if (content.blob !== undefined) {
      // Convert binary to base64 for transport
      resourceContent.blob = Buffer.from(content.blob).toString("base64");
    }

    return {
      contents: [resourceContent],
    };
  }

  protected handlePromptsList(): { prompts: McpPromptDescriptor[] } {
    return {
      prompts: Array.from(this.prompts.values()).map((p) => p.toDescriptor()),
    };
  }

  protected async handlePromptsGet(
    params: Record<string, unknown>,
    context?: McpContext,
  ): Promise<McpPromptGetResult> {
    const name = params.name as string;
    const args = (params.arguments ?? {}) as Record<string, string>;

    const prompt = this.prompts.get(name);
    if (!prompt) {
      throw new McpPromptNotFoundError(name);
    }

    const messages = await prompt.get(args, context);

    const mcpMessages: McpPromptMessage[] = messages.map((msg) => ({
      role: msg.role,
      content: {
        type: "text" as const,
        text: msg.content,
      },
    }));

    return {
      description: prompt.description,
      messages: mcpMessages,
    };
  }
}
