import { AlephaError } from "alepha";
import type { McpToolCallResult } from "alepha/mcp";

/**
 * The view's side of MCP Apps (`io.modelcontextprotocol/ui`, spec
 * 2026-01-26): JSON-RPC over `postMessage` with the host that renders the
 * view in its iframe.
 *
 * It opens with `ui/initialize`, then keeps what the host sends (the tool's
 * input and result, the host's theme) in {@link state}, and forwards the
 * view's own requests: a tool called back, a link to open, a message for the
 * conversation. Written for the protocol rather than over
 * `@modelcontextprotocol/ext-apps`, whose peers are the whole MCP SDK.
 *
 * A view mounted by `McpView.mount` has one, read through `useMcpApp()`.
 */
export class McpAppBridge {
  /**
   * The MCP Apps revision this bridge speaks.
   */
  public static readonly PROTOCOL_VERSION = "2026-01-26";

  public state: McpAppState = {
    ready: false,
    theme: "light",
    hostContext: {},
  };

  protected nextId = 1;
  protected readonly pending = new Map<
    number,
    { resolve: (value: any) => void; reject: (error: Error) => void }
  >();
  protected readonly listeners = new Set<() => void>();
  protected connected?: Promise<void>;

  protected readonly host: McpAppHostWindow;
  protected readonly self: McpAppSelfWindow;
  protected readonly appInfo: { name: string; version: string };

  constructor(
    host: McpAppHostWindow,
    self: McpAppSelfWindow,
    appInfo: { name: string; version: string } = {
      name: "alepha-mcp-view",
      version: "1.0.0",
    },
  ) {
    this.host = host;
    this.self = self;
    this.appInfo = appInfo;
  }

  /**
   * Open the conversation with the host: `ui/initialize`, then
   * `ui/notifications/initialized`. Called once; later calls return the
   * same promise.
   */
  public connect(): Promise<void> {
    this.connected ??= this.open();
    return this.connected;
  }

  /**
   * Call a tool of the MCP server the view belongs to, through the host.
   */
  public callTool(
    name: string,
    args: Record<string, unknown> = {},
  ): Promise<McpToolCallResult> {
    return this.request("tools/call", { name, arguments: args });
  }

  /**
   * Ask the host to open a URL, in a browser tab or wherever it opens links.
   */
  public async openLink(url: string): Promise<void> {
    await this.request("ui/open-link", { url });
  }

  /**
   * Add a message to the conversation, as the user.
   */
  public async sendMessage(text: string): Promise<void> {
    await this.request("ui/message", {
      role: "user",
      content: { type: "text", text },
    });
  }

  /**
   * Tell the host the view's size, so it can fit the iframe to it.
   */
  public notifySize(width: number, height: number): void {
    this.notify("ui/notifications/size-changed", { width, height });
  }

  public subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  public getState(): McpAppState {
    return this.state;
  }

  /**
   * Stop listening to the host. Pending requests are rejected.
   */
  public close(): void {
    this.self.removeEventListener("message", this.onMessage);
    for (const it of this.pending.values()) {
      it.reject(new AlephaError("MCP Apps bridge closed"));
    }
    this.pending.clear();
  }

  // -------------------------------------------------------------------------------------------------------------------

  protected async open(): Promise<void> {
    this.self.addEventListener("message", this.onMessage);
    const result = await this.request("ui/initialize", {
      protocolVersion: McpAppBridge.PROTOCOL_VERSION,
      appInfo: this.appInfo,
      appCapabilities: {},
    });
    this.update({
      ready: true,
      hostContext: this.isObject(result?.hostContext) ? result.hostContext : {},
      theme: this.themeOf(result?.hostContext) ?? this.state.theme,
    });
    this.notify("ui/notifications/initialized", {});
  }

  protected readonly onMessage = (event: {
    source?: unknown;
    data?: unknown;
  }): void => {
    if (event.source !== this.host) {
      return;
    }
    const message = event.data as JsonRpcMessage | undefined;
    if (!this.isObject(message) || message.jsonrpc !== "2.0") {
      return;
    }
    if (typeof message.method === "string") {
      this.onHostMessage(message);
      return;
    }
    if (typeof message.id === "number") {
      const waiting = this.pending.get(message.id);
      if (!waiting) {
        return;
      }
      this.pending.delete(message.id);
      if (message.error) {
        waiting.reject(
          new AlephaError(
            String(message.error.message ?? "MCP Apps request failed"),
          ),
        );
      } else {
        waiting.resolve(message.result);
      }
    }
  };

  protected onHostMessage(message: JsonRpcMessage): void {
    const params = this.isObject(message.params) ? message.params : {};
    switch (message.method) {
      case "ui/notifications/tool-input":
      case "ui/notifications/tool-input-partial":
        this.update({
          input: this.isObject(params.arguments) ? params.arguments : {},
        });
        return;
      case "ui/notifications/tool-result":
        this.update({ result: params as unknown as McpToolCallResult });
        return;
      case "ui/notifications/tool-cancelled":
        this.update({ cancelled: String(params.reason ?? "cancelled") });
        return;
      case "ui/notifications/host-context-changed":
        this.update({
          hostContext: { ...this.state.hostContext, ...params },
          theme: this.themeOf(params) ?? this.state.theme,
        });
        return;
      case "ui/resource-teardown":
        if (message.id !== undefined) {
          this.host.postMessage(
            { jsonrpc: "2.0", id: message.id, result: {} },
            "*",
          );
        }
        return;
      default:
        if (message.id !== undefined) {
          this.host.postMessage(
            {
              jsonrpc: "2.0",
              id: message.id,
              error: { code: -32601, message: "Method not found" },
            },
            "*",
          );
        }
    }
  }

  protected request(
    method: string,
    params: Record<string, unknown>,
  ): Promise<any> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.host.postMessage({ jsonrpc: "2.0", id, method, params }, "*");
    });
  }

  protected notify(method: string, params: Record<string, unknown>): void {
    this.host.postMessage({ jsonrpc: "2.0", method, params }, "*");
  }

  protected update(patch: Partial<McpAppState>): void {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) {
      listener();
    }
  }

  protected themeOf(context: unknown): "light" | "dark" | undefined {
    const theme = this.isObject(context) ? context.theme : undefined;
    return theme === "dark" || theme === "light" ? theme : undefined;
  }

  protected isObject(value: unknown): value is Record<string, any> {
    return !!value && typeof value === "object" && !Array.isArray(value);
  }
}

/**
 * What the host told the view so far.
 */
export interface McpAppState {
  /**
   * Whether `ui/initialize` was answered.
   */
  ready: boolean;
  /**
   * The tool call's arguments, once the host sent them.
   */
  input?: Record<string, unknown>;
  /**
   * The tool call's result, once it is in.
   */
  result?: McpToolCallResult;
  /**
   * Why the call was cancelled, when it was.
   */
  cancelled?: string;
  /**
   * The host's color scheme.
   */
  theme: "light" | "dark";
  /**
   * Everything else the host said about itself (`styles`, `displayMode`,
   * `locale`, ...), merged as it changes.
   */
  hostContext: Record<string, any>;
}

/**
 * The window the host listens on: `window.parent` in an iframe.
 */
export interface McpAppHostWindow {
  postMessage: (message: unknown, targetOrigin: string) => void;
}

/**
 * The view's own window, which receives the host's messages.
 */
export interface McpAppSelfWindow {
  addEventListener: (type: "message", listener: (event: any) => void) => void;
  removeEventListener: (
    type: "message",
    listener: (event: any) => void,
  ) => void;
}

interface JsonRpcMessage {
  jsonrpc: "2.0";
  id?: number | string;
  method?: string;
  params?: unknown;
  result?: any;
  error?: { code?: number; message?: string };
}
