import { $inject, Alepha } from "alepha";
import { $logger } from "alepha/logger";
import { AlephaContext } from "alepha/react";
import type { SimpleHead } from "alepha/react/head";
import { createElement, type ReactNode } from "react";
import { renderToString } from "react-dom/server";
import ErrorViewer from "../components/ErrorViewer.tsx";
import { Redirection } from "../errors/Redirection.ts";
import type { ReactRouterState } from "./ReactPageProvider.ts";

/**
 * Handles HTML streaming for SSR.
 *
 * Uses hardcoded HTML structure - all customization via $head primitive.
 * Pre-encodes static parts as Uint8Array for zero-copy streaming.
 */
export class ReactServerTemplateProvider {
  protected readonly log = $logger();
  protected readonly alepha = $inject(Alepha);

  /**
   * Shared TextEncoder - reused across all requests.
   */
  protected readonly encoder = new TextEncoder();

  /**
   * Pre-encoded static HTML parts for zero-copy streaming.
   */
  protected readonly SLOTS = {
    DOCTYPE: this.encoder.encode("<!DOCTYPE html>\n"),
    HTML_OPEN: this.encoder.encode("<html"),
    HTML_CLOSE: this.encoder.encode(">\n"),
    HEAD_OPEN: this.encoder.encode("<head>"),
    HEAD_CLOSE: this.encoder.encode("</head>\n"),
    BODY_OPEN: this.encoder.encode("<body"),
    BODY_CLOSE: this.encoder.encode(">\n"),
    ROOT_OPEN: this.encoder.encode('<div id="root">'),
    ROOT_CLOSE: this.encoder.encode("</div>\n"),
    BODY_HTML_CLOSE: this.encoder.encode("</body>\n</html>"),
    HYDRATION_PREFIX: this.encoder.encode(
      '<script id="__ssr" type="application/json">',
    ),
    HYDRATION_SUFFIX: this.encoder.encode("</script>"),
  } as const;

  /**
   * Early head content (charset, viewport, entry assets).
   * Set once during configuration, reused for all requests.
   */
  protected earlyHeadContent = "";

  /**
   * Root element ID for React mounting.
   */
  public readonly rootId = "root";

  /**
   * Regex for extracting root div content from HTML.
   */
  public readonly rootDivRegex = new RegExp(
    `<div[^>]*\\s+id=["']${this.rootId}["'][^>]*>([\\s\\S]*?)<\\/div>`,
    "i",
  );

  /**
   * Extract content inside the root div from HTML.
   */
  public extractRootContent(html: string): string | undefined {
    return html.match(this.rootDivRegex)?.[1];
  }

  /**
   * Set early head content (charset, viewport, entry assets).
   * Called once during server configuration.
   */
  public setEarlyHeadContent(
    entryAssets: string,
    globalHead?: SimpleHead,
  ): void {
    const charset = globalHead?.charset ?? "UTF-8";
    const viewport =
      globalHead?.viewport ?? "width=device-width, initial-scale=1";

    this.earlyHeadContent =
      `<meta charset="${this.escapeHtml(charset)}">\n` +
      `<meta name="viewport" content="${this.escapeHtml(viewport)}">\n` +
      entryAssets;
  }

  /**
   * Render attributes record to HTML string.
   */
  public renderAttributes(attrs?: Record<string, string>): string {
    if (!attrs) return "";
    const entries = Object.entries(attrs);
    if (entries.length === 0) return "";
    return entries
      .map(([key, value]) => ` ${key}="${this.escapeHtml(value)}"`)
      .join("");
  }

  /**
   * Render head content (title, meta, link, script tags).
   */
  public renderHeadContent(head?: SimpleHead): string {
    if (!head) return "";

    let content = "";

    if (head.title) {
      content += `<title>${this.escapeHtml(head.title)}</title>\n`;
    }

    if (head.meta) {
      for (const meta of head.meta) {
        if (meta.property) {
          content += `<meta property="${this.escapeHtml(meta.property)}" content="${this.escapeHtml(meta.content)}">\n`;
        } else if (meta.name) {
          content += `<meta name="${this.escapeHtml(meta.name)}" content="${this.escapeHtml(meta.content)}">\n`;
        }
      }
    }

    if (head.link) {
      for (const link of head.link) {
        content += `<link rel="${this.escapeHtml(link.rel)}" href="${this.escapeHtml(link.href)}"`;
        if (link.type) content += ` type="${this.escapeHtml(link.type)}"`;
        if (link.as) content += ` as="${this.escapeHtml(link.as)}"`;
        if (link.crossorigin != null) content += ' crossorigin=""';
        if (link.media) content += ` media="${this.escapeHtml(link.media)}"`;
        if (link.sizes) content += ` sizes="${this.escapeHtml(link.sizes)}"`;
        if (link.hreflang)
          content += ` hreflang="${this.escapeHtml(link.hreflang)}"`;
        content += ">\n";
      }
    }

    if (head.script) {
      for (const script of head.script) {
        if (typeof script === "string") {
          content += `<script>${script}</script>\n`;
        } else {
          const { content: scriptContent, ...rest } = script;
          const attrs = Object.entries(rest)
            .filter(([, v]) => v !== false && v !== undefined)
            .map(([k, v]) =>
              v === true ? k : `${k}="${this.escapeHtml(String(v))}"`,
            )
            .join(" ");
          content += scriptContent
            ? `<script ${attrs}>${scriptContent}</script>\n`
            : `<script ${attrs}></script>\n`;
        }
      }
    }

    return content;
  }

  /**
   * Escape HTML special characters.
   */
  public escapeHtml(str: string): string {
    return str
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  /**
   * Safely serialize data to JSON for embedding in HTML.
   */
  public safeJsonSerialize(data: unknown): string {
    return JSON.stringify(data)
      .replace(/</g, "\\u003c")
      .replace(/>/g, "\\u003e")
      .replace(/&/g, "\\u0026");
  }

  /**
   * Build hydration data from router state.
   */
  public buildHydrationData(state: ReactRouterState): HydrationData {
    const layers = state.layers.map((layer) => ({
      part: layer.part,
      name: layer.name,
      config: layer.config,
      props: layer.props,
      error: layer.error
        ? {
            ...layer.error,
            name: layer.error.name,
            message: layer.error.message,
            stack: !this.alepha.isProduction() ? layer.error.stack : undefined,
          }
        : undefined,
    }));

    return {
      "alepha.react.router.layers": layers,
      ...this.alepha.store.exportAtoms("current"),
    };
  }

  // ---------------------------------------------------------------------------
  // Core streaming methods
  // ---------------------------------------------------------------------------

  /**
   * Pipe React stream to controller with backpressure handling.
   * Returns true if stream completed successfully, false if error occurred.
   */
  protected async pipeReactStream(
    controller: ReadableStreamDefaultController<Uint8Array>,
    reactStream: ReadableStream<Uint8Array>,
    state: ReactRouterState,
  ): Promise<boolean> {
    const reader = reactStream.getReader();

    try {
      while (true) {
        // No backpressure here, deliberately. The previous `if desiredSize <= 0
        // await queueMicrotask` was a no-op dressed as one: a microtask cannot
        // let the consumer pull, and it ran once rather than looping. Real
        // backpressure needs the consumer's `pull` callback, which this
        // ReadableStream does not expose to us.
        const { done, value } = await reader.read();
        if (done) break;
        controller.enqueue(value);
      }
      return true;
    } catch (error) {
      this.log.error("React stream error", error);
      controller.enqueue(
        this.encoder.encode(
          this.renderErrorToString(
            error instanceof Error ? error : new Error(String(error)),
            state,
          ),
        ),
      );
      return false;
    } finally {
      reader.releaseLock();
    }
  }

  /**
   * Stream complete HTML document (head already closed).
   * Used by both createHtmlStream and late phase of createEarlyHtmlStream.
   */
  protected async streamBodyAndClose(
    controller: ReadableStreamDefaultController<Uint8Array>,
    reactStream: ReadableStream<Uint8Array>,
    state: ReactRouterState,
    hydration: boolean,
  ): Promise<void> {
    const { encoder, SLOTS: slots } = this;

    // Body open
    controller.enqueue(slots.BODY_OPEN);
    controller.enqueue(
      encoder.encode(this.renderAttributes(state.head?.bodyAttributes)),
    );
    controller.enqueue(slots.BODY_CLOSE);

    // Root + React content
    controller.enqueue(slots.ROOT_OPEN);
    await this.pipeReactStream(controller, reactStream, state);
    controller.enqueue(slots.ROOT_CLOSE);

    // Hydration
    if (hydration) {
      controller.enqueue(slots.HYDRATION_PREFIX);
      controller.enqueue(
        encoder.encode(this.safeJsonSerialize(this.buildHydrationData(state))),
      );
      controller.enqueue(slots.HYDRATION_SUFFIX);
    }

    controller.enqueue(slots.BODY_HTML_CLOSE);
  }

  // ---------------------------------------------------------------------------
  // Public streaming APIs
  // ---------------------------------------------------------------------------

  /**
   * Create HTML stream with early head optimization.
   *
   * Flow:
   * 1. Send DOCTYPE, <html>, <head> open, entry preloads (IMMEDIATE)
   * 2. Run async work (page loaders)
   * 3. Send rest of head, body, React content, hydration
   */
  public createEarlyHtmlStream(
    globalHead: SimpleHead,
    asyncWork: () => Promise<
      | { state: ReactRouterState; reactStream: ReadableStream<Uint8Array> }
      | { redirect: string }
      | null
    >,
    options: {
      hydration?: boolean;
      state?: ReactRouterState;
      onError?: (error: unknown) => void;
    } = {},
  ): ReadableStream<Uint8Array> {
    const { hydration = true, onError } = options;
    const { encoder, SLOTS: slots } = this;

    let headClosed = false;
    let bodyStarted = false;
    let routerState: ReactRouterState | undefined = options.state;

    return new ReadableStream<Uint8Array>({
      start: async (controller) => {
        try {
          // === EARLY PHASE (before async work) ===
          controller.enqueue(slots.DOCTYPE);
          controller.enqueue(slots.HTML_OPEN);
          controller.enqueue(
            encoder.encode(this.renderAttributes(globalHead?.htmlAttributes)),
          );
          controller.enqueue(slots.HTML_CLOSE);
          controller.enqueue(slots.HEAD_OPEN);
          if (this.earlyHeadContent) {
            controller.enqueue(encoder.encode(this.earlyHeadContent));
          }

          // === ASYNC WORK ===
          const result = await asyncWork();

          // Handle redirect
          if (!result || "redirect" in result) {
            if (result && "redirect" in result) {
              this.log.debug("Loader redirect, using meta refresh", {
                redirect: result.redirect,
              });
              controller.enqueue(
                encoder.encode(
                  `<meta http-equiv="refresh" content="0; url=${this.escapeHtml(result.redirect)}">\n`,
                ),
              );
            }
            controller.enqueue(slots.HEAD_CLOSE);
            controller.enqueue(encoder.encode("<body></body></html>"));
            controller.close();
            return;
          }

          const { state, reactStream } = result;
          routerState = state;

          // === LATE PHASE (after async work) ===
          controller.enqueue(
            encoder.encode(this.renderHeadContent(state.head)),
          );
          controller.enqueue(slots.HEAD_CLOSE);
          headClosed = true;
          bodyStarted = true;

          await this.streamBodyAndClose(
            controller,
            reactStream,
            state,
            hydration,
          );
          controller.close();
        } catch (error) {
          onError?.(error);
          try {
            this.injectErrorHtml(controller, error, routerState, {
              headClosed,
              bodyStarted,
            });
            controller.close();
          } catch {
            controller.error(error);
          }
        }
      },
    });
  }

  /**
   * Create HTML stream (non-early version, for testing/prerender).
   */
  public createHtmlStream(
    reactStream: ReadableStream<Uint8Array>,
    state: ReactRouterState,
    options: { hydration?: boolean; onError?: (error: unknown) => void } = {},
  ): ReadableStream<Uint8Array> {
    const { hydration = true, onError } = options;
    const { encoder, SLOTS: slots } = this;

    return new ReadableStream<Uint8Array>({
      start: async (controller) => {
        try {
          // Head
          controller.enqueue(slots.DOCTYPE);
          controller.enqueue(slots.HTML_OPEN);
          controller.enqueue(
            encoder.encode(this.renderAttributes(state.head?.htmlAttributes)),
          );
          controller.enqueue(slots.HTML_CLOSE);
          controller.enqueue(slots.HEAD_OPEN);
          if (this.earlyHeadContent) {
            controller.enqueue(encoder.encode(this.earlyHeadContent));
          }
          controller.enqueue(
            encoder.encode(this.renderHeadContent(state.head)),
          );
          controller.enqueue(slots.HEAD_CLOSE);

          // Body (shared logic)
          await this.streamBodyAndClose(
            controller,
            reactStream,
            state,
            hydration,
          );
          controller.close();
        } catch (error) {
          onError?.(error);
          controller.error(error);
        }
      },
    });
  }

  // ---------------------------------------------------------------------------
  // Error handling
  // ---------------------------------------------------------------------------

  /**
   * Inject error HTML when streaming fails.
   */
  protected injectErrorHtml(
    controller: ReadableStreamDefaultController<Uint8Array>,
    error: unknown,
    routerState: ReactRouterState | undefined,
    streamState: { headClosed: boolean; bodyStarted: boolean },
  ): void {
    const { encoder, SLOTS: slots } = this;

    if (!streamState.headClosed) {
      controller.enqueue(
        encoder.encode(this.renderHeadContent(routerState?.head)),
      );
      controller.enqueue(slots.HEAD_CLOSE);
    }

    if (!streamState.bodyStarted) {
      controller.enqueue(slots.BODY_OPEN);
      controller.enqueue(
        encoder.encode(
          this.renderAttributes(routerState?.head?.bodyAttributes),
        ),
      );
      controller.enqueue(slots.BODY_CLOSE);
      controller.enqueue(slots.ROOT_OPEN);
    }

    controller.enqueue(
      encoder.encode(
        this.renderErrorToString(
          error instanceof Error ? error : new Error(String(error)),
          routerState,
        ),
      ),
    );

    controller.enqueue(slots.ROOT_CLOSE);

    if (routerState) {
      controller.enqueue(slots.HYDRATION_PREFIX);
      controller.enqueue(
        encoder.encode(
          this.safeJsonSerialize(this.buildHydrationData(routerState)),
        ),
      );
      controller.enqueue(slots.HYDRATION_SUFFIX);
    }

    controller.enqueue(slots.BODY_HTML_CLOSE);
  }

  /**
   * Render error to HTML string.
   */
  protected renderErrorToString(
    error: Error,
    routerState: ReactRouterState | undefined,
  ): string {
    this.log.error("SSR rendering error", error);

    let errorElement: ReactNode;

    if (routerState?.onError) {
      try {
        const result = routerState.onError(error, routerState);
        if (result instanceof Redirection) {
          this.log.warn("Error handler returned Redirection but headers sent", {
            redirect: result.redirect,
          });
        } else if (result != null) {
          errorElement = result;
        }
      } catch (handlerError) {
        this.log.error("Error handler threw", handlerError);
      }
    }

    if (!errorElement) {
      errorElement = createElement(ErrorViewer, {
        error,
        alepha: this.alepha,
      });
    }

    const wrappedElement = createElement(
      AlephaContext.Provider,
      { value: this.alepha },
      errorElement,
    );

    try {
      return renderToString(wrappedElement);
    } catch (renderError) {
      this.log.error("Failed to render error component", renderError);
      return error.message;
    }
  }
}

/**
 * Hydration state serialized to a JSON script tag with id="__ssr"
 */
export interface HydrationData {
  "alepha.react.router.layers": Array<{
    part?: string;
    name?: string;
    config?: Record<string, any>;
    props?: Record<string, any>;
    error?: { name: string; message: string; stack?: string };
  }>;
  [key: string]: unknown;
}
