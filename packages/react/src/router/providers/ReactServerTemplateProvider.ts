import { $inject, Alepha, AlephaError } from "alepha";
import { $logger } from "alepha/logger";
import type { SimpleHead } from "@alepha/react/head";
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
   *
   * @param template - The HTML template string (typically index.html)
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
      doctype: this.encoder.encode(doctype + "\n"),
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
    let match: RegExpExecArray | null;

    while ((match = attrRegex.exec(attrStr))) {
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
    as?: string;
    crossorigin?: string;
  }): string {
    let tag = `<link rel="${this.escapeHtml(link.rel)}" href="${this.escapeHtml(link.href)}"`;
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
  protected renderScriptTag(script: Record<string, string | boolean>): string {
    const attrs = Object.entries(script)
      .filter(([, value]) => value !== false)
      .map(([key, value]) => {
        if (value === true) return key;
        return `${key}="${this.escapeHtml(String(value))}"`;
      })
      .join(" ");
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
      name: layer.name,
      props: layer.props,
      config: layer.config,
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
    }

    for (const [key, value] of Object.entries(store)) {
      if (key.charAt(0) !== "_" && key !== "alepha.react.router.state" && key !== "registry") {
        hydrationData[key] = value;
      }
    }

    return hydrationData;
  }

  /**
   * Encode a string to Uint8Array using the shared encoder.
   */
  public encode(str: string): Uint8Array {
    return this.encoder.encode(str);
  }

  /**
   * Get the pre-encoded hydration script prefix.
   */
  public get hydrationPrefix(): Uint8Array {
    return this.ENCODED.HYDRATION_PREFIX;
  }

  /**
   * Get the pre-encoded hydration script suffix.
   */
  public get hydrationSuffix(): Uint8Array {
    return this.ENCODED.HYDRATION_SUFFIX;
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
          // 1. DOCTYPE
          controller.enqueue(slots.doctype);

          // 2. <html ...>
          controller.enqueue(slots.htmlOpen);
          controller.enqueue(
            encoder.encode(this.renderMergedHtmlAttrs(head?.htmlAttributes)),
          );
          controller.enqueue(slots.htmlClose);

          // 3. <head>...</head>
          controller.enqueue(slots.headOpen);
          // Include early head content (entry.js, CSS) if set
          if (this.earlyHeadContent) {
            controller.enqueue(encoder.encode(this.earlyHeadContent));
          }
          controller.enqueue(encoder.encode(this.renderHeadContent(head)));
          controller.enqueue(slots.headClose);

          // 4. <body ...>
          controller.enqueue(slots.bodyOpen);
          controller.enqueue(
            encoder.encode(this.renderMergedBodyAttrs(head?.bodyAttributes)),
          );
          controller.enqueue(slots.bodyClose);

          // 5. Content before root (if any)
          if (slots.beforeRoot) {
            controller.enqueue(encoder.encode(slots.beforeRoot));
          }

          // 6. <div id="root">
          controller.enqueue(slots.rootOpen);

          // 7. Stream React content
          const reader = reactStream.getReader();
          try {
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              controller.enqueue(value);
            }
          } finally {
            reader.releaseLock();
          }

          // 8. </div>
          controller.enqueue(slots.rootClose);

          // 9. Content after root (if any)
          if (slots.afterRoot) {
            controller.enqueue(encoder.encode(slots.afterRoot));
          }

          // 10. Hydration script
          if (hydration) {
            const hydrationData = this.buildHydrationData(state);
            controller.enqueue(this.ENCODED.HYDRATION_PREFIX);
            controller.enqueue(
              encoder.encode(this.safeJsonSerialize(hydrationData)),
            );
            controller.enqueue(this.ENCODED.HYDRATION_SUFFIX);
          }

          // 11. </body></html>
          controller.enqueue(slots.scriptClose);

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
   * @param content - HTML string with entry assets
   * @param entryAssets - Entry asset paths to strip from original head
   */
  public setEarlyHeadContent(
    content: string,
    entryAssets?: { js?: string; css: string[] },
  ): void {
    this.earlyHeadContent = content;

    // Strip entry assets from original head content to avoid duplicates
    if (entryAssets && this.slots) {
      let headContent = this.slots.headOriginalContent;

      // Remove entry script tag
      if (entryAssets.js) {
        // Match script tag with this src (handles various attribute orders)
        const scriptPattern = new RegExp(
          `<script[^>]*\\ssrc=["']${this.escapeRegExp(entryAssets.js)}["'][^>]*>\\s*</script>\\s*`,
          "gi",
        );
        headContent = headContent.replace(scriptPattern, "");
      }

      // Remove entry CSS link tags
      for (const css of entryAssets.css) {
        const linkPattern = new RegExp(
          `<link[^>]*\\shref=["']${this.escapeRegExp(css)}["'][^>]*>\\s*`,
          "gi",
        );
        headContent = headContent.replace(linkPattern, "");
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

    return new ReadableStream<Uint8Array>({
      start: async (controller) => {
        try {
          // === EARLY PHASE (before async work) ===

          // 1. DOCTYPE
          controller.enqueue(slots.doctype);

          // 2. <html ...> with global htmlAttributes only
          controller.enqueue(slots.htmlOpen);
          controller.enqueue(
            encoder.encode(
              this.renderMergedHtmlAttrs(globalHead?.htmlAttributes),
            ),
          );
          controller.enqueue(slots.htmlClose);

          // 3. <head> open + entry preloads
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
          const head = state.head;

          // === LATE PHASE (after async work) ===

          // 4. Rest of head content (title, meta, links from loaders)
          controller.enqueue(encoder.encode(this.renderHeadContent(head)));
          controller.enqueue(slots.headClose);

          // 5. <body ...> with merged bodyAttributes
          controller.enqueue(slots.bodyOpen);
          controller.enqueue(
            encoder.encode(this.renderMergedBodyAttrs(head?.bodyAttributes)),
          );
          controller.enqueue(slots.bodyClose);

          // 6. Content before root (if any)
          if (slots.beforeRoot) {
            controller.enqueue(encoder.encode(slots.beforeRoot));
          }

          // 7. <div id="root">
          controller.enqueue(slots.rootOpen);

          // 8. Stream React content
          const reader = reactStream.getReader();
          try {
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              controller.enqueue(value);
            }
          } finally {
            reader.releaseLock();
          }

          // 9. </div>
          controller.enqueue(slots.rootClose);

          // 10. Content after root (if any)
          if (slots.afterRoot) {
            controller.enqueue(encoder.encode(slots.afterRoot));
          }

          // 11. Hydration script
          if (hydration) {
            const hydrationData = this.buildHydrationData(state);
            controller.enqueue(this.ENCODED.HYDRATION_PREFIX);
            controller.enqueue(
              encoder.encode(this.safeJsonSerialize(hydrationData)),
            );
            controller.enqueue(this.ENCODED.HYDRATION_SUFFIX);
          }

          // 12. </body></html>
          controller.enqueue(slots.scriptClose);

          controller.close();
        } catch (error) {
          onError?.(error);
          controller.error(error);
        }
      },
    });
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
