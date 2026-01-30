import { $inject, Alepha, AlephaError } from "alepha";
import { $logger } from "alepha/logger";
import { AlephaContext } from "alepha/react";
import type { SimpleHead } from "alepha/react/head";
import { createElement, type ReactNode } from "react";
import { renderToString } from "react-dom/server";
import ErrorViewer from "../components/ErrorViewer.tsx";
import { Redirection } from "../errors/Redirection.ts";
import type { ReactRouterState } from "./ReactPageProvider.ts";

/**
 * Handles HTML template parsing, preprocessing, and streaming for SSR.
 *
 * Responsibilities:
 * - Parse template once at startup into logical slots
 * - Pre-encode static parts as Uint8Array for zero-copy streaming
 * - Render dynamic parts (attributes, head content) efficiently
 * - Build hydration data for client-side rehydration
 *
 * This provider is injected into ReactServerProvider to handle all
 * template-related operations, keeping ReactServerProvider focused
 * on request handling and React rendering coordination.
 */
export class ReactServerTemplateProvider {
  protected readonly log = $logger();
  protected readonly alepha = $inject(Alepha);

  /**
   * Shared TextEncoder instance - reused across all requests.
   */
  protected readonly encoder = new TextEncoder();

  /**
   * Pre-encoded common strings for streaming.
   */
  protected readonly ENCODED = {
    HYDRATION_PREFIX: this.encoder.encode("<script>window.__ssr="),
    HYDRATION_SUFFIX: this.encoder.encode("</script>"),
    EMPTY: this.encoder.encode(""),
  } as const;

  /**
   * Cached template slots - parsed once, reused for all requests.
   */
  protected slots: TemplateSlots | null = null;

  /**
   * Root element ID for React mounting.
   */
  public get rootId(): string {
    return "root";
  }

  /**
   * Regex pattern for matching the root div and extracting its content.
   */
  public get rootDivRegex(): RegExp {
    return new RegExp(
      `<div([^>]*)\\s+id=["']${this.rootId}["']([^>]*)>([\\s\\S]*?)<\\/div>`,
      "i",
    );
  }

  /**
   * Extract the content inside the root div from HTML.
   *
   * @param html - Full HTML string
   * @returns The content inside the root div, or undefined if not found
   */
  public extractRootContent(html: string): string | undefined {
    const match = html.match(this.rootDivRegex);
    return match?.[3];
  }

  /**
   * Check if template has been parsed and slots are available.
   */
  public isReady(): boolean {
    return this.slots !== null;
  }

  /**
   * Get the parsed template slots.
   * Throws if template hasn't been parsed yet.
   */
  public getSlots(): TemplateSlots {
    if (!this.slots) {
      throw new AlephaError(
        "Template not parsed. Call parseTemplate() during configuration.",
      );
    }
    return this.slots;
  }

  /**
   * Parse an HTML template into logical slots for efficient streaming.
   *
   * This should be called once during server startup/configuration.
   * The parsed slots are cached and reused for all requests.
   */
  public parseTemplate(template: string): TemplateSlots {
    this.log.debug("Parsing template into slots");

    const rootId = this.rootId;

    // Extract doctype
    const doctypeMatch = template.match(/<!DOCTYPE[^>]*>/i);
    const doctype = doctypeMatch?.[0] ?? "<!DOCTYPE html>";
    let remaining = doctypeMatch
      ? template.slice(doctypeMatch.index! + doctypeMatch[0].length)
      : template;

    // Extract <html> tag and attributes
    const htmlMatch = remaining.match(/<html([^>]*)>/i);
    const htmlAttrsStr = htmlMatch?.[1]?.trim() ?? "";
    const htmlOriginalAttrs = this.parseAttributes(htmlAttrsStr);
    remaining = htmlMatch
      ? remaining.slice(htmlMatch.index! + htmlMatch[0].length)
      : remaining;

    // Extract <head> content
    const headMatch = remaining.match(/<head([^>]*)>([\s\S]*?)<\/head>/i);
    const headOriginalContent = headMatch?.[2]?.trim() ?? "";
    remaining = headMatch
      ? remaining.slice(headMatch.index! + headMatch[0].length)
      : remaining;

    // Extract <body> tag and attributes
    const bodyMatch = remaining.match(/<body([^>]*)>/i);
    const bodyAttrsStr = bodyMatch?.[1]?.trim() ?? "";
    const bodyOriginalAttrs = this.parseAttributes(bodyAttrsStr);
    const bodyStartIndex = bodyMatch
      ? bodyMatch.index! + bodyMatch[0].length
      : 0;
    remaining = remaining.slice(bodyStartIndex);

    // Find root div
    const rootDivRegex = new RegExp(
      `<div([^>]*)\\s+id=["']${rootId}["']([^>]*)>([\\s\\S]*?)<\\/div>`,
      "i",
    );
    const rootMatch = remaining.match(rootDivRegex);

    let beforeRoot = "";
    let afterRoot = "";
    let rootAttrs = "";

    if (rootMatch) {
      beforeRoot = remaining.slice(0, rootMatch.index!).trim();
      const rootEndIndex = rootMatch.index! + rootMatch[0].length;
      // Find </body> for afterRoot
      const bodyCloseIndex = remaining.indexOf("</body>");
      afterRoot =
        bodyCloseIndex > rootEndIndex
          ? remaining.slice(rootEndIndex, bodyCloseIndex).trim()
          : "";
      rootAttrs = `${rootMatch[1] ?? ""}${rootMatch[2] ?? ""}`.trim();
    } else {
      // No root div found - will inject one
      const bodyCloseIndex = remaining.indexOf("</body>");
      if (bodyCloseIndex > 0) {
        beforeRoot = remaining.slice(0, bodyCloseIndex).trim();
      }
    }

    // Build the root div opening tag
    const rootOpenTag = rootAttrs
      ? `<div ${rootAttrs} id="${rootId}">`
      : `<div id="${rootId}">`;

    this.slots = {
      // Pre-encoded static parts
      doctype: this.encoder.encode(`${doctype}\n`),
      htmlOpen: this.encoder.encode("<html"),
      htmlClose: this.encoder.encode(">\n"),
      headOpen: this.encoder.encode("<head>"),
      headClose: this.encoder.encode("</head>\n"),
      bodyOpen: this.encoder.encode("<body"),
      bodyClose: this.encoder.encode(">\n"),
      rootOpen: this.encoder.encode(rootOpenTag),
      rootClose: this.encoder.encode("</div>\n"),
      scriptClose: this.encoder.encode("</body>\n</html>"),

      // Original content for merging
      htmlOriginalAttrs,
      bodyOriginalAttrs,
      headOriginalContent,
      beforeRoot,
      afterRoot,
    };

    this.log.debug("Template parsed successfully", {
      hasHtmlAttrs: Object.keys(htmlOriginalAttrs).length > 0,
      hasBodyAttrs: Object.keys(bodyOriginalAttrs).length > 0,
      hasHeadContent: headOriginalContent.length > 0,
      hasBeforeRoot: beforeRoot.length > 0,
      hasAfterRoot: afterRoot.length > 0,
    });

    return this.slots;
  }

  /**
   * Parse HTML attributes string into a record.
   *
   * Handles: key="value", key='value', key=value, and boolean key
   */
  protected parseAttributes(attrStr: string): Record<string, string> {
    const attrs: Record<string, string> = {};
    if (!attrStr) return attrs;

    // Match: key="value", key='value', key=value, or just key (boolean)
    const attrRegex = /([^\s=]+)(?:=(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;

    for (const match of attrStr.matchAll(attrRegex)) {
      const key = match[1];
      const value = match[2] ?? match[3] ?? match[4] ?? "";
      attrs[key] = value;
    }

    return attrs;
  }

  /**
   * Render attributes record to HTML string.
   *
   * @param attrs - Attributes to render
   * @returns HTML attribute string like ` lang="en" class="dark"`
   */
  public renderAttributes(attrs: Record<string, string>): string {
    const entries = Object.entries(attrs);
    if (entries.length === 0) return "";

    return entries
      .map(([key, value]) => ` ${key}="${this.escapeHtml(value)}"`)
      .join("");
  }

  /**
   * Render merged HTML attributes (original + dynamic).
   */
  public renderMergedHtmlAttrs(dynamicAttrs?: Record<string, string>): string {
    const slots = this.getSlots();
    const merged = { ...slots.htmlOriginalAttrs, ...dynamicAttrs };
    return this.renderAttributes(merged);
  }

  /**
   * Render merged body attributes (original + dynamic).
   */
  public renderMergedBodyAttrs(dynamicAttrs?: Record<string, string>): string {
    const slots = this.getSlots();
    const merged = { ...slots.bodyOriginalAttrs, ...dynamicAttrs };
    return this.renderAttributes(merged);
  }

  /**
   * Render head content (title, meta, link, script tags).
   *
   * @param head - Head data to render
   * @param includeOriginal - Whether to include original head content
   * @returns HTML string with head content
   */
  public renderHeadContent(head?: SimpleHead, includeOriginal = true): string {
    const slots = this.getSlots();
    let content = "";

    // Include original head content first
    if (includeOriginal && slots.headOriginalContent) {
      content += slots.headOriginalContent;
    }

    if (!head) return content;

    // Title - check if already exists in original content
    if (head.title) {
      if (content.includes("<title>")) {
        // Replace existing title
        content = content.replace(
          /<title>.*?<\/title>/i,
          `<title>${this.escapeHtml(head.title)}</title>`,
        );
      } else {
        content += `<title>${this.escapeHtml(head.title)}</title>\n`;
      }
    }

    // Meta tags
    if (head.meta) {
      for (const meta of head.meta) {
        content += this.renderMetaTag(meta);
      }
    }

    // Link tags
    if (head.link) {
      for (const link of head.link) {
        content += this.renderLinkTag(link);
      }
    }

    // Script tags
    if (head.script) {
      for (const script of head.script) {
        content += this.renderScriptTag(script);
      }
    }

    return content;
  }

  /**
   * Render a meta tag.
   */
  protected renderMetaTag(meta: {
    name?: string;
    property?: string;
    content: string;
  }): string {
    if (meta.property) {
      return `<meta property="${this.escapeHtml(meta.property)}" content="${this.escapeHtml(meta.content)}">\n`;
    }
    if (meta.name) {
      return `<meta name="${this.escapeHtml(meta.name)}" content="${this.escapeHtml(meta.content)}">\n`;
    }
    return "";
  }

  /**
   * Render a link tag.
   */
  protected renderLinkTag(link: {
    rel: string;
    href: string;
    type?: string;
    as?: string;
    crossorigin?: string;
  }): string {
    let tag = `<link rel="${this.escapeHtml(link.rel)}" href="${this.escapeHtml(link.href)}"`;
    if (link.type) {
      tag += ` type="${this.escapeHtml(link.type)}"`;
    }
    if (link.as) {
      tag += ` as="${this.escapeHtml(link.as)}"`;
    }
    if (link.crossorigin != null) {
      tag += ' crossorigin=""';
    }
    tag += ">\n";
    return tag;
  }

  /**
   * Render a script tag.
   */
  protected renderScriptTag(
    script:
      | string
      | (Record<string, string | boolean | undefined> & { content?: string }),
  ): string {
    // Handle plain string as inline script
    if (typeof script === "string") {
      return `<script>${script}</script>\n`;
    }

    const { content, ...rest } = script;
    const attrs = Object.entries(rest)
      .filter(([, value]) => value !== false && value !== undefined)
      .map(([key, value]) => {
        if (value === true) return key;
        return `${key}="${this.escapeHtml(String(value))}"`;
      })
      .join(" ");

    if (content) {
      return attrs
        ? `<script ${attrs}>${content}</script>\n`
        : `<script>${content}</script>\n`;
    }
    return `<script ${attrs}></script>\n`;
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
   * Escapes characters that could break out of script tags.
   */
  public safeJsonSerialize(data: unknown): string {
    return JSON.stringify(data)
      .replace(/</g, "\\u003c")
      .replace(/>/g, "\\u003e")
      .replace(/&/g, "\\u0026");
  }

  /**
   * Build hydration data from router state.
   *
   * This creates the data structure that will be serialized to window.__ssr
   * for client-side rehydration.
   */
  public buildHydrationData(state: ReactRouterState): HydrationData {
    const { request, context, ...store } =
      this.alepha.context.als?.getStore() ?? {};

    const layers = state.layers.map((layer) => ({
      part: layer.part, // mandatory for previous-checking
      name: layer.name, // mandatory for previous-checking
      config: layer.config, // mandatory for previous-checking (contains 'query' & 'params')
      props: layer.props, // our not-so-secret data cache
      error: layer.error
        ? {
            ...layer.error,
            name: layer.error.name,
            message: layer.error.message,
            stack: !this.alepha.isProduction() ? layer.error.stack : undefined,
          }
        : undefined,
    }));

    const hydrationData: HydrationData = {
      layers,
    };

    for (const [key, value] of Object.entries(store)) {
      if (
        key.charAt(0) !== "_" &&
        key !== "alepha.react.router.state" &&
        key !== "registry"
      ) {
        hydrationData[key] = value;
      }
    }

    return hydrationData;
  }

  /**
   * Stream the body content: body tag, root div, React content, hydration, and closing tags.
   *
   * If an error occurs during React streaming, it injects error HTML instead of aborting,
   * ensuring users see an error message rather than a white screen.
   */
  protected async streamBodyContent(
    controller: ReadableStreamDefaultController<Uint8Array>,
    reactStream: ReadableStream<Uint8Array>,
    state: ReactRouterState,
    hydration: boolean,
  ): Promise<void> {
    const slots = this.getSlots();
    const encoder = this.encoder;
    const head = state.head;

    // <body ...>
    controller.enqueue(slots.bodyOpen);
    controller.enqueue(
      encoder.encode(this.renderMergedBodyAttrs(head?.bodyAttributes)),
    );
    controller.enqueue(slots.bodyClose);

    // Content before root (if any)
    if (slots.beforeRoot) {
      controller.enqueue(encoder.encode(slots.beforeRoot));
    }

    // <div id="root">
    controller.enqueue(slots.rootOpen);

    // Stream React content - catch errors from the React stream
    const reader = reactStream.getReader();
    let streamError: unknown = null;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        controller.enqueue(value);
      }
    } catch (error) {
      // React stream errored - save for error HTML injection
      streamError = error;
      this.log.error("Error during React stream reading", error);
    } finally {
      reader.releaseLock();
    }

    // If React stream errored, inject error HTML inside the root div
    if (streamError) {
      this.injectErrorHtml(controller, encoder, slots, streamError, state, {
        headClosed: true,
        bodyStarted: true,
      });
      // injectErrorHtml already closes the document, so return early
      return;
    }

    // </div>
    controller.enqueue(slots.rootClose);

    // Content after root (if any)
    if (slots.afterRoot) {
      controller.enqueue(encoder.encode(slots.afterRoot));
    }

    // Hydration script
    if (hydration) {
      const hydrationData = this.buildHydrationData(state);
      controller.enqueue(this.ENCODED.HYDRATION_PREFIX);
      controller.enqueue(encoder.encode(this.safeJsonSerialize(hydrationData)));
      controller.enqueue(this.ENCODED.HYDRATION_SUFFIX);
    }

    // </body></html>
    controller.enqueue(slots.scriptClose);
  }

  /**
   * Create a ReadableStream that streams the HTML template with React content.
   *
   * This is the main entry point for SSR streaming. It:
   * 1. Sends <head> immediately (browser starts downloading assets)
   * 2. Streams React content as it renders
   * 3. Appends hydration script and closing tags
   *
   * @param reactStream - ReadableStream from renderToReadableStream
   * @param state - Router state with head data
   * @param options - Streaming options
   */
  public createHtmlStream(
    reactStream: ReadableStream<Uint8Array>,
    state: ReactRouterState,
    options: {
      hydration?: boolean;
      onError?: (error: unknown) => void;
    } = {},
  ): ReadableStream<Uint8Array> {
    const { hydration = true, onError } = options;
    const slots = this.getSlots();
    const head = state.head;
    const encoder = this.encoder;

    return new ReadableStream<Uint8Array>({
      start: async (controller) => {
        try {
          // DOCTYPE
          controller.enqueue(slots.doctype);

          // <html ...>
          controller.enqueue(slots.htmlOpen);
          controller.enqueue(
            encoder.encode(this.renderMergedHtmlAttrs(head?.htmlAttributes)),
          );
          controller.enqueue(slots.htmlClose);

          // <head>...</head>
          controller.enqueue(slots.headOpen);
          if (this.earlyHeadContent) {
            controller.enqueue(encoder.encode(this.earlyHeadContent));
          }
          controller.enqueue(encoder.encode(this.renderHeadContent(head)));
          controller.enqueue(slots.headClose);

          // Body content (body, root, React, hydration, closing tags)
          await this.streamBodyContent(
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

  /**
   * Early head content for preloading.
   *
   * Contains entry assets (JS + CSS) that are always required and can be
   * sent before page loaders run.
   */
  protected earlyHeadContent: string = "";

  /**
   * Set the early head content (entry script + CSS).
   *
   * Also strips these assets from the original head content to avoid duplicates,
   * since we're moving them to the early phase.
   *
   * Automatically prepends critical meta tags (charset, viewport) if not present
   * in $head configuration, ensuring they're sent as early as possible.
   *
   * @param content - HTML string with entry assets
   * @param globalHead - Global head configuration from $head primitives
   * @param entryAssets - Entry asset paths to strip from original head
   */
  public setEarlyHeadContent(
    content: string,
    globalHead?: SimpleHead,
    entryAssets?: { js?: string; css: string[] },
  ): void {
    // Build early content with critical meta tags first
    const criticalMeta: string[] = [];

    // Add charset - use custom value from $head or default to UTF-8
    const charset = globalHead?.charset ?? "UTF-8";
    criticalMeta.push(`<meta charset="${this.escapeHtml(charset)}">`);

    // Add viewport - use custom value from $head or default
    const viewport =
      globalHead?.viewport ?? "width=device-width, initial-scale=1";
    criticalMeta.push(
      `<meta name="viewport" content="${this.escapeHtml(viewport)}">`,
    );

    // Prepend critical meta tags before entry assets
    this.earlyHeadContent =
      criticalMeta.length > 0
        ? `${criticalMeta.join("\n")}\n${content}`
        : content;

    // Strip early-injected content from original head to avoid duplicates
    if (this.slots) {
      let headContent = this.slots.headOriginalContent;

      // Remove charset meta tag (we inject it early)
      headContent = headContent.replace(/<meta\s+charset=[^>]*>\s*/gi, "");

      // Remove viewport meta tag (we inject it early)
      headContent = headContent.replace(
        /<meta\s+name=["']viewport["'][^>]*>\s*/gi,
        "",
      );

      // Remove entry script tag
      if (entryAssets?.js) {
        // Match script tag with this src (handles various attribute orders)
        const scriptPattern = new RegExp(
          `<script[^>]*\\ssrc=["']${this.escapeRegExp(entryAssets.js)}["'][^>]*>\\s*</script>\\s*`,
          "gi",
        );
        headContent = headContent.replace(scriptPattern, "");
      }

      // Remove entry CSS link tags
      if (entryAssets?.css) {
        for (const css of entryAssets.css) {
          const linkPattern = new RegExp(
            `<link[^>]*\\shref=["']${this.escapeRegExp(css)}["'][^>]*>\\s*`,
            "gi",
          );
          headContent = headContent.replace(linkPattern, "");
        }
      }

      this.slots.headOriginalContent = headContent.trim();
    }
  }

  /**
   * Escape special regex characters in a string.
   */
  protected escapeRegExp(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  /**
   * Create an optimized HTML stream with early head streaming.
   *
   * This version sends critical assets (entry.js, CSS) BEFORE page loaders run,
   * allowing the browser to start downloading them immediately.
   *
   * Flow:
   * 1. Send DOCTYPE, <html>, <head> open, entry preloads (IMMEDIATE)
   * 2. Run async work (createLayers, etc.)
   * 3. Send rest of head, body, React content, hydration
   *
   * @param globalHead - Global head with htmlAttributes (from $head primitives)
   * @param asyncWork - Async function to run between early head and rest of stream
   * @param options - Streaming options
   */
  public createEarlyHtmlStream(
    globalHead: SimpleHead,
    asyncWork: () => Promise<
      | {
          state: ReactRouterState;
          reactStream: ReadableStream<Uint8Array>;
        }
      | { redirect: string }
      | null
    >,
    options: {
      hydration?: boolean;
      onError?: (error: unknown) => void;
    } = {},
  ): ReadableStream<Uint8Array> {
    const { hydration = true, onError } = options;
    const slots = this.getSlots();
    const encoder = this.encoder;

    // Track streaming state for error recovery
    let headClosed = false;
    let bodyStarted = false;
    let routerState: ReactRouterState | undefined;

    return new ReadableStream<Uint8Array>({
      start: async (controller) => {
        try {
          // === EARLY PHASE (before async work) ===

          // DOCTYPE
          controller.enqueue(slots.doctype);

          // <html ...> with global htmlAttributes only
          controller.enqueue(slots.htmlOpen);
          controller.enqueue(
            encoder.encode(
              this.renderMergedHtmlAttrs(globalHead?.htmlAttributes),
            ),
          );
          controller.enqueue(slots.htmlClose);

          // <head> open + entry preloads
          controller.enqueue(slots.headOpen);
          if (this.earlyHeadContent) {
            controller.enqueue(encoder.encode(this.earlyHeadContent));
          }

          // === ASYNC WORK (createLayers, etc.) ===
          const result = await asyncWork();

          // Handle redirect - inject meta refresh since headers already sent
          if (!result || "redirect" in result) {
            if (result && "redirect" in result) {
              this.log.debug(
                "Loader redirect detected after streaming started, using meta refresh",
                { redirect: result.redirect },
              );
              controller.enqueue(
                encoder.encode(
                  `<meta http-equiv="refresh" content="0; url=${this.escapeHtml(result.redirect)}">\n`,
                ),
              );
            }
            controller.enqueue(slots.headClose);
            controller.enqueue(encoder.encode("<body></body></html>"));
            controller.close();
            return;
          }

          const { state, reactStream } = result;
          routerState = state;

          // === LATE PHASE (after async work) ===

          // Rest of head content (title, meta, links from loaders)
          controller.enqueue(
            encoder.encode(this.renderHeadContent(state.head)),
          );
          controller.enqueue(slots.headClose);
          headClosed = true;

          // Body content (body, root, React, hydration, closing tags)
          bodyStarted = true;
          await this.streamBodyContent(
            controller,
            reactStream,
            state,
            hydration,
          );

          controller.close();
        } catch (error) {
          onError?.(error);

          // Instead of aborting the stream, inject error HTML so user sees
          // an error message instead of white screen.
          // React 19 streaming SSR doesn't reliably trigger ErrorBoundary,
          // so we must handle it at the stream level.
          try {
            this.injectErrorHtml(
              controller,
              encoder,
              slots,
              error,
              routerState,
              { headClosed, bodyStarted },
            );
            controller.close();
          } catch {
            // If error injection fails, abort as last resort
            controller.error(error);
          }
        }
      },
    });
  }

  /**
   * Inject error HTML into the stream when an error occurs during streaming.
   *
   * Uses the router state's onError handler to render the error component,
   * falling back to ErrorViewer if no custom handler is defined.
   * Renders using renderToString to produce static HTML.
   *
   * Since we may have already sent partial HTML (DOCTYPE, <html>, <head>),
   * we need to complete the document with an error message instead of aborting.
   *
   * Handles different states:
   * - headClosed=false, bodyStarted=false: Need to add head content, close head, open body, add error, close all
   * - headClosed=true, bodyStarted=false: Need to open body, add error, close all
   * - headClosed=true, bodyStarted=true: Already inside root div, add error, close all
   */
  protected injectErrorHtml(
    controller: ReadableStreamDefaultController<Uint8Array>,
    encoder: TextEncoder,
    slots: TemplateSlots,
    error: unknown,
    routerState: ReactRouterState | undefined,
    streamState: { headClosed: boolean; bodyStarted: boolean },
  ): void {
    // If head not closed, add remaining head content first
    if (!streamState.headClosed) {
      // Include original head content (CSS, scripts) and any head from router state
      const headContent = this.renderHeadContent(routerState?.head);
      if (headContent) {
        controller.enqueue(encoder.encode(headContent));
      }
      controller.enqueue(slots.headClose);
    }

    // If body hasn't started, we need to open body and root div
    if (!streamState.bodyStarted) {
      // Open body with any body attributes from state
      controller.enqueue(slots.bodyOpen);
      controller.enqueue(
        encoder.encode(
          this.renderMergedBodyAttrs(routerState?.head?.bodyAttributes),
        ),
      );
      controller.enqueue(slots.bodyClose);

      // Content before root (if any)
      if (slots.beforeRoot) {
        controller.enqueue(encoder.encode(slots.beforeRoot));
      }

      controller.enqueue(slots.rootOpen);
    }

    // Try to render error using router state's error handler
    const errorHtml = this.renderErrorToString(
      error instanceof Error ? error : new Error(String(error)),
      routerState,
    );

    controller.enqueue(encoder.encode(errorHtml));

    // Close root div
    controller.enqueue(slots.rootClose);

    // Content after root (if any)
    if (!streamState.bodyStarted && slots.afterRoot) {
      controller.enqueue(encoder.encode(slots.afterRoot));
    }

    // Close document
    controller.enqueue(slots.scriptClose);
  }

  /**
   * Render an error to HTML string using the router's error handler.
   *
   * Falls back to ErrorViewer if:
   * - No router state is available
   * - The error handler returns null/undefined
   * - The error handler itself throws
   */
  protected renderErrorToString(
    error: Error,
    routerState: ReactRouterState | undefined,
  ): string {
    // Log the error with stack trace for debugging
    this.log.error("SSR rendering error", error);

    let errorElement: ReactNode;

    // Try to use the router state's error handler
    if (routerState?.onError) {
      try {
        const result = routerState.onError(error, routerState);

        // If handler returns a Redirection, we can't handle it (headers already sent)
        // Log and fall through to default error viewer
        if (result instanceof Redirection) {
          this.log.warn(
            "Error handler returned Redirection but headers already sent",
            { redirect: result.redirect },
          );
        } else if (result !== null && result !== undefined) {
          errorElement = result;
        }
      } catch (handlerError) {
        this.log.error("Error handler threw an exception", handlerError);
        // Fall through to default error viewer
      }
    }

    // Fall back to ErrorViewer if no element was produced
    if (!errorElement) {
      errorElement = createElement(ErrorViewer, {
        error,
        alepha: this.alepha,
      });
    }

    // Wrap in AlephaContext.Provider so any components that need it can access it
    const wrappedElement = createElement(
      AlephaContext.Provider,
      { value: this.alepha },
      errorElement,
    );

    try {
      return renderToString(wrappedElement);
    } catch (renderError) {
      // If renderToString fails, return minimal fallback HTML
      this.log.error("Failed to render error component", renderError);
      return error.message;
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------------

/**
 * Template slots - the template split into logical parts for efficient streaming.
 *
 * Static parts are pre-encoded as Uint8Array for zero-copy streaming.
 * Dynamic parts (attributes, head content) are kept as strings/objects for merging.
 */
export interface TemplateSlots {
  // Pre-encoded static parts
  doctype: Uint8Array;
  htmlOpen: Uint8Array; // "<html"
  htmlClose: Uint8Array; // ">"
  headOpen: Uint8Array; // "<head>"
  headClose: Uint8Array; // "</head>"
  bodyOpen: Uint8Array; // "<body"
  bodyClose: Uint8Array; // ">"
  rootOpen: Uint8Array; // '<div id="root">'
  rootClose: Uint8Array; // "</div>"
  scriptClose: Uint8Array; // "</body></html>"

  // Original content (kept for merging)
  htmlOriginalAttrs: Record<string, string>;
  bodyOriginalAttrs: Record<string, string>;
  headOriginalContent: string;
  beforeRoot: string; // content between <body> and root div
  afterRoot: string; // content between root div and </body>
}

/**
 * Hydration state that gets serialized to window.__ssr
 */
export interface HydrationData {
  layers: Array<{
    data?: unknown;
    error?: {
      name: string;
      message: string;
      stack?: string;
    };
  }>;
  [key: string]: unknown;
}
