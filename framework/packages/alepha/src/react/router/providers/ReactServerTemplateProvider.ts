import { $inject, Alepha } from "alepha";
import { $logger } from "alepha/logger";
import { AlephaContext } from "alepha/react";
import { ServerHeadProvider, type SimpleHead } from "alepha/react/head";
import { ServerHelmetProvider } from "alepha/server";
import { createElement, type ReactNode } from "react";

import ErrorViewer from "../components/ErrorViewer.tsx";
import { Redirection } from "../errors/Redirection.ts";
import { ReactDeferred } from "../services/ReactDeferred.ts";
import { ReactDomServerProvider } from "./ReactDomServerProvider.ts";
import type { PageCacheSink } from "./ReactPageCacheProvider.ts";
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
  protected readonly reactDomServer = $inject(ReactDomServerProvider);
  protected readonly deferred = $inject(ReactDeferred);
  protected readonly helmet = $inject(ServerHelmetProvider);
  protected readonly serverHead = $inject(ServerHeadProvider);

  /**
   * The CSP nonce of the page being rendered, when it has one.
   */
  protected nonce(): string | undefined {
    return this.alepha.store.getUntracked("alepha.react.router.nonce");
  }

  /**
   * ` nonce="..."` for an inline script no hash covers, on a rendered page
   * with a nonce; nothing otherwise. A script registered by its hash (a
   * literal global `$head`) is written bare, so its bytes stay cacheable.
   */
  protected nonceAttribute(
    script: NonNullable<SimpleHead["script"]>[number],
  ): string {
    const nonce = this.nonce();
    if (!nonce) {
      return "";
    }
    const content = this.serverHead.executableInlineContent(script);
    if (!content || this.helmet.isCspScriptHashed(content)) {
      return "";
    }
    return ` nonce="${nonce}"`;
  }

  /**
   * What React is told to write as its bootstrap script on a page with a
   * deferred value: the one point in its stream that is right after the
   * shell, and between two tags. Replaced on the way out by the payload.
   */
  public readonly shellMarker = "/*alepha:shell*/";

  /**
   * Shared TextEncoder - reused across all requests.
   */
  protected readonly encoder = new TextEncoder();

  /**
   * The body of the boot signal a streamed page with a deferred value writes
   * right after its payload. Constant, so the CSP allows it by its hash
   * (`ReactServerProvider` registers it with `ServerHelmetProvider`).
   */
  public readonly bootSignalScript =
    'self.__alephaBoot=1;document.dispatchEvent(new Event("alepha:boot"))';

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
    PRIVATE_PREFIX: this.encoder.encode(
      '<script id="__ssr_private" type="application/json">',
    ),
    BOOT_SIGNAL: this.encoder.encode(
      `<script>${this.bootSignalScript}</script>`,
    ),
  } as const;

  /**
   * Early head content (charset, viewport, entry assets).
   * Set once during configuration, reused for all requests.
   */
  protected earlyHeadContent = "";

  /**
   * Head content for standalone error documents: the same charset/viewport
   * prefix and stylesheets, but **no entry script**.
   *
   * An error document is not the app. If it shipped the entry module, the
   * client would boot, find no `#__ssr` payload, and client-render the very
   * URL the server just refused — replacing a 503 or a guard's refusal with a
   * working-looking page. Dropping the script is what keeps that from
   * happening; the cost is that these pages are not interactive.
   */
  protected errorHeadContent = "";

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
    this.earlyHeadContent = this.composeHeadContent(entryAssets, globalHead);
  }

  /**
   * Set the head content used by standalone error documents.
   *
   * Takes stylesheets and the favicon, never the entry script — see
   * {@link errorHeadContent}.
   */
  public setErrorHeadContent(
    styleAssets: string,
    globalHead?: SimpleHead,
  ): void {
    this.errorHeadContent = this.composeHeadContent(styleAssets, globalHead);
  }

  protected composeHeadContent(
    assets: string,
    globalHead?: SimpleHead,
  ): string {
    const charset = globalHead?.charset ?? "UTF-8";
    const viewport =
      globalHead?.viewport ?? "width=device-width, initial-scale=1";

    return (
      `<meta charset="${this.escapeHtml(charset)}">\n` +
      `<meta name="viewport" content="${this.escapeHtml(viewport)}">\n` +
      assets
    );
  }

  /**
   * How the page hands the browser the `browser: true` keys of the env, ahead
   * of the entry script so they are in `alepha.env` before any `$env` is
   * read. Empty when the app declares none.
   *
   * - **At runtime** (the app started): a JSON data block with the server's
   *   values, `<script id="__alepha_env" type="application/json">`. The same
   *   for every visitor, so the page cache verdict stays `shared`, and not
   *   executable, so a strict CSP accepts it.
   * - **At build time** (a prerendered page, a static site's HTML): no value
   *   at all, only `<script src="/config.js">`. The build machine's values
   *   must never be baked into a file served in another environment; the
   *   host's `config.js` (written per environment, or answered by the
   *   server) supplies them.
   *
   * A Capacitor shell ({@link renderShellDocument}) carries neither: there is
   * no container to write `config.js` in, and it keeps `define`.
   */
  public browserEnvHead(): string {
    if (this.alepha.browserEnvKeys().length === 0) {
      return "";
    }
    if (!this.alepha.isStarted()) {
      return '<script src="/config.js"></script>\n';
    }
    return `<script id="${Alepha.BROWSER_ENV_ELEMENT}" type="application/json">${this.safeJsonSerialize(this.alepha.browserEnv())}</script>\n`;
  }

  /**
   * The document with an empty root: the early head, the given head, and no
   * page content or hydration data.
   *
   * What an app shell ships, a WebView or a static host booting the client
   * with nothing rendered on the server. Body attributes are kept, so a global
   * `$head` that styles the body applies before the first render.
   */
  public renderShellDocument(head: SimpleHead): string {
    return (
      "<!DOCTYPE html>\n" +
      `<html${this.renderAttributes(head.htmlAttributes)}>\n` +
      `<head>${this.earlyHeadContent}${this.renderHeadContent(head)}</head>\n` +
      `<body${this.renderAttributes(head.bodyAttributes)}>\n` +
      `<div id="${this.rootId}"></div>\n` +
      "</body>\n</html>"
    );
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
        const media = meta.media
          ? ` media="${this.escapeHtml(meta.media)}"`
          : "";
        if (meta.property) {
          content += `<meta property="${this.escapeHtml(meta.property)}" content="${this.escapeHtml(meta.content)}"${media}>\n`;
        } else if (meta.name) {
          content += `<meta name="${this.escapeHtml(meta.name)}" content="${this.escapeHtml(meta.content)}"${media}>\n`;
        }
      }
    }

    if (head.link) {
      for (const link of head.link) {
        content += `<link rel="${this.escapeHtml(link.rel)}" href="${this.escapeHtml(link.href)}"`;
        if (link.type) content += ` type="${this.escapeHtml(link.type)}"`;
        if (link.as) content += ` as="${this.escapeHtml(link.as)}"`;
        if (link.crossorigin != null)
          content += ` crossorigin="${
            link.crossorigin === true ? "" : this.escapeHtml(link.crossorigin)
          }"`;
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
          content += `<script${this.nonceAttribute(script)}>${script}</script>\n`;
        } else {
          const { content: scriptContent, ...rest } = script;
          const attrs = Object.entries(rest)
            .filter(([, v]) => v !== false && v !== undefined)
            .map(([k, v]) =>
              v === true ? k : `${k}="${this.escapeHtml(String(v))}"`,
            )
            .join(" ");
          const nonce = this.nonceAttribute(script);
          content += scriptContent
            ? `<script ${attrs}${nonce}>${scriptContent}</script>\n`
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
   * Build the shared hydration data: the router layers and every atom that
   * is not personal. This is what the page shows, the same for every visitor
   * of the same URL, and the only payload a page cache may store.
   */
  public buildHydrationData(state: ReactRouterState): HydrationData {
    const layers = state.layers.map((layer, index) => ({
      part: layer.part,
      name: layer.name,
      // Hydration's reuse check compares identities: without it every layer
      // would re-run its loader on first load.
      key: layer.key,
      config: layer.config,
      props: this.deferred.serialize(layer.props, index + 1),
      error: layer.error
        ? {
            // Deliberately flattening an Error for the SSR payload: `name` and `message`
            // are non-enumerable, which is why they are re-added on the next lines.
            // oxlint-disable-next-line typescript/no-misused-spread
            ...layer.error,
            name: layer.error.name,
            message: layer.error.message,
            stack: !this.alepha.isProduction() ? layer.error.stack : undefined,
          }
        : undefined,
    }));

    return {
      "alepha.react.router.layers": layers,
      ...this.alepha.store.exportAtoms("current", { personal: false }),
    };
  }

  /**
   * Build the private hydration data: the personal atoms of this request
   * (the user, the API links, the UI preferences, every cookie-bound atom
   * but the language). Who the page is for, written to its own
   * `<script id="__ssr_private">` and rebuilt for every request, so a cached
   * page never carries it. See `AtomOptions.personal`.
   */
  public buildPrivateData(): Record<string, unknown> {
    return this.alepha.store.exportAtoms("current", { personal: true });
  }

  /**
   * The `<script id="__ssr_private">` element for the current request, or
   * an empty string when the request has no personal state.
   *
   * Public because a page cache hit appends it to bytes it did not render.
   */
  public renderPrivateScript(): string {
    const data = this.buildPrivateData();
    // On a page with a CSP nonce the element is written even when empty: it
    // is how the browser learns the nonce (`BrowserHeadProvider` reads
    // `script[nonce]`) to allow the head scripts of a later navigation. It is
    // never shared bytes, so the nonce stays out of the page cache.
    const nonce = this.nonce();
    if (Object.keys(data).length === 0 && !nonce) {
      return "";
    }
    const attribute = nonce ? ` nonce="${nonce}"` : "";
    return `<script id="__ssr_private" type="application/json"${attribute}>${this.safeJsonSerialize(data)}</script>`;
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
    onShell?: () => void,
  ): Promise<boolean> {
    const reader = reactStream.getReader();
    const scanner = onShell
      ? this.shellScanner(onShell, (chunk) => controller.enqueue(chunk))
      : undefined;

    try {
      while (true) {
        // No backpressure here, deliberately. The previous `if desiredSize <= 0
        // await queueMicrotask` was a no-op dressed as one: a microtask cannot
        // let the consumer pull, and it ran once rather than looping. Real
        // backpressure needs the consumer's `pull` callback, which this
        // ReadableStream does not expose to us.
        const { done, value } = await reader.read();
        if (done) break;
        if (scanner) {
          for (const chunk of scanner.scan(value)) {
            controller.enqueue(chunk);
          }
        } else {
          controller.enqueue(value);
        }
      }
      for (const chunk of scanner?.flush() ?? []) {
        controller.enqueue(chunk);
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
   * Finds React's bootstrap script in its stream and calls `onShell` in its
   * place, ahead of whatever follows. The marker can straddle two chunks, so
   * the end of each is held back until the next.
   */
  protected shellScanner(
    onShell: () => void,
    onChunk: (chunk: Uint8Array) => void,
  ) {
    const decoder = new TextDecoder("latin1");
    // React writes the tag with an id of its own, so the match starts at the
    // last `<script` before the marker.
    const marker = `${this.shellMarker}</script>`;
    // With a CSP nonce React writes ` nonce="..."` into that tag as well:
    // held back too short, a tag cut between two chunks is flushed in half.
    const nonce = this.nonce();
    const longest =
      marker.length +
      '<script id="_R_">'.length +
      (nonce ? ` nonce="${nonce}"`.length : 0);
    let held = new Uint8Array();
    let found = false;

    return {
      scan: (chunk: Uint8Array): Uint8Array[] => {
        if (found) {
          return [chunk];
        }

        const joined = new Uint8Array(held.length + chunk.length);
        joined.set(held);
        joined.set(chunk, held.length);

        // latin1 keeps one character per byte, so an index is a byte offset.
        const text = decoder.decode(joined);
        const end = text.indexOf(marker);
        if (end !== -1) {
          found = true;
          held = new Uint8Array();
          const at = text.lastIndexOf("<script", end);
          onChunk(joined.subarray(0, at));
          onShell();
          return [joined.subarray(end + marker.length)];
        }

        const keep = Math.min(joined.length, longest);
        held = joined.slice(joined.length - keep);
        return [joined.subarray(0, joined.length - keep)];
      },
      flush: (): Uint8Array[] => [held],
    };
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
  ): Promise<boolean> {
    const { encoder, SLOTS: slots } = this;

    // Body open
    controller.enqueue(slots.BODY_OPEN);
    controller.enqueue(
      encoder.encode(this.renderAttributes(state.head?.bodyAttributes)),
    );
    controller.enqueue(slots.BODY_CLOSE);

    // A page with a deferred value writes its payload right after the shell,
    // which is what lets hydration start before the stream ends. Any other
    // writes it after the root, at the end of the document.
    let payloadWritten = false;
    const writePayload = () => {
      if (payloadWritten || !hydration) {
        return;
      }
      payloadWritten = true;
      controller.enqueue(slots.HYDRATION_PREFIX);
      controller.enqueue(
        encoder.encode(this.safeJsonSerialize(this.buildHydrationData(state))),
      );
      controller.enqueue(slots.HYDRATION_SUFFIX);
      this.enqueuePrivateScript(controller);
    };

    // Root + React content
    controller.enqueue(slots.ROOT_OPEN);
    const ok = await this.pipeReactStream(
      controller,
      reactStream,
      state,
      this.deferred.has(state.layers)
        ? () => {
            writePayload();
            if (payloadWritten) {
              controller.enqueue(slots.BOOT_SIGNAL);
            }
          }
        : undefined,
    );
    controller.enqueue(slots.ROOT_CLOSE);

    writePayload();

    controller.enqueue(slots.BODY_HTML_CLOSE);
    return ok;
  }

  /**
   * Write the private script, the one part of a document that is never
   * shared. Everything enqueued before it is the same for every visitor of
   * the URL; it is followed only by the closing tags.
   */
  protected enqueuePrivateScript(
    controller: ReadableStreamDefaultController<Uint8Array>,
  ): void {
    const sink = (controller as TeeController).sink;
    sink?.beginPrivate();
    const script = this.renderPrivateScript();
    if (script) {
      controller.enqueue(this.encoder.encode(script));
    }
    sink?.endPrivate();
  }

  /**
   * A controller that also writes every chunk into the page cache's sink.
   * Without a sink it is the controller itself.
   */
  protected tee(
    controller: ReadableStreamDefaultController<Uint8Array>,
    sink: PageCacheSink | undefined,
  ): ReadableStreamDefaultController<Uint8Array> {
    if (!sink) {
      return controller;
    }
    const tee: TeeController = {
      sink,
      get desiredSize() {
        return controller.desiredSize;
      },
      enqueue: (chunk?: Uint8Array) => {
        if (chunk) {
          sink.write(chunk);
        }
        controller.enqueue(chunk);
      },
      close: () => controller.close(),
      error: (reason?: unknown) => controller.error(reason),
    };
    return tee;
  }

  // ---------------------------------------------------------------------------
  // Public streaming APIs
  // ---------------------------------------------------------------------------

  /**
   * Create HTML stream with early head optimization.
   *
   * Flow:
   * 1. Send DOCTYPE, <html>, <head> open, entry assets and the route's own
   *    preload links (IMMEDIATE)
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
      /**
       * Per-request head content for the EARLY phase, sent before the async
       * work rather than after it.
       *
       * {@link setEarlyHeadContent} cannot serve this: it runs once at
       * configuration, and this fragment is the route's own.
       */
      earlyHead?: string;
      onError?: (error: unknown) => void;
      /**
       * The page cache's tee. Told at the end whether the render finished
       * cleanly: an error page or a meta-refresh redirect closes the stream
       * like a success.
       */
      sink?: PageCacheSink;
    } = {},
  ): ReadableStream<Uint8Array> {
    const { hydration = true, onError, sink } = options;
    const { encoder, SLOTS: slots } = this;

    let headClosed = false;
    let bodyStarted = false;
    let routerState: ReactRouterState | undefined = options.state;

    return new ReadableStream<Uint8Array>({
      start: async (output) => {
        const controller = this.tee(output, sink);
        try {
          // === EARLY PHASE (before async work) ===
          controller.enqueue(slots.DOCTYPE);
          controller.enqueue(slots.HTML_OPEN);
          controller.enqueue(
            encoder.encode(this.renderAttributes(globalHead?.htmlAttributes)),
          );
          controller.enqueue(slots.HTML_CLOSE);
          controller.enqueue(slots.HEAD_OPEN);
          const browserEnv = this.browserEnvHead();
          if (browserEnv) {
            controller.enqueue(encoder.encode(browserEnv));
          }
          if (this.earlyHeadContent) {
            controller.enqueue(encoder.encode(this.earlyHeadContent));
          }
          if (options.earlyHead) {
            controller.enqueue(encoder.encode(options.earlyHead));
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
            sink?.done(false);
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

          const ok = await this.streamBodyAndClose(
            controller,
            reactStream,
            state,
            hydration,
          );
          sink?.done(ok);
          controller.close();
        } catch (error) {
          sink?.done(false);
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
    options: {
      hydration?: boolean;
      onError?: (error: unknown) => void;
      sink?: PageCacheSink;
    } = {},
  ): ReadableStream<Uint8Array> {
    const { hydration = true, onError, sink } = options;
    const { encoder, SLOTS: slots } = this;

    return new ReadableStream<Uint8Array>({
      start: async (output) => {
        const controller = this.tee(output, sink);
        try {
          // Head
          controller.enqueue(slots.DOCTYPE);
          controller.enqueue(slots.HTML_OPEN);
          controller.enqueue(
            encoder.encode(this.renderAttributes(state.head?.htmlAttributes)),
          );
          controller.enqueue(slots.HTML_CLOSE);
          controller.enqueue(slots.HEAD_OPEN);
          const browserEnv = this.browserEnvHead();
          if (browserEnv) {
            controller.enqueue(encoder.encode(browserEnv));
          }
          if (this.earlyHeadContent) {
            controller.enqueue(encoder.encode(this.earlyHeadContent));
          }
          controller.enqueue(
            encoder.encode(this.renderHeadContent(state.head)),
          );
          controller.enqueue(slots.HEAD_CLOSE);

          // Body (shared logic)
          const ok = await this.streamBodyAndClose(
            controller,
            reactStream,
            state,
            hydration,
          );
          sink?.done(ok);
          controller.close();
        } catch (error) {
          sink?.done(false);
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
      this.enqueuePrivateScript(controller);
    }

    controller.enqueue(slots.BODY_HTML_CLOSE);
  }

  /**
   * Render a complete, standalone HTML document for an error.
   *
   * This is the answer for a failure that happened *before* any React stream
   * opened — a guard, a hook, a middleware — where the streaming error paths
   * above have nothing to inject into. Nothing has been flushed yet, so the
   * whole document is built at once and returned as a string.
   *
   * Deliberately not hydrated: see {@link errorHeadContent}.
   */
  public async renderErrorDocument(
    error: Error,
    options: { element?: ReactNode; head?: SimpleHead } = {},
  ): Promise<string> {
    // The error paths below read the renderer synchronously (they normally run
    // inside a stream controller). Nothing loaded it for us here, so do it now.
    await this.reactDomServer.load();

    const { head } = options;

    return (
      "<!DOCTYPE html>\n" +
      `<html${this.renderAttributes(head?.htmlAttributes)}>\n` +
      "<head>" +
      this.errorHeadContent +
      this.renderHeadContent(head) +
      "</head>\n" +
      `<body${this.renderAttributes(head?.bodyAttributes)}>\n` +
      `<div id="${this.rootId}">` +
      this.renderErrorToString(error, undefined, options.element) +
      "</div>\n" +
      "</body>\n</html>"
    );
  }

  /**
   * Render error to HTML string.
   *
   * `element` short-circuits the `onError` lookup for callers that already
   * resolved a custom error component — the pre-stream path does, because it
   * has to inspect the result for a `Redirection` while a redirect is still
   * possible.
   */
  protected renderErrorToString(
    error: Error,
    routerState: ReactRouterState | undefined,
    element?: ReactNode,
  ): string {
    this.log.error("SSR rendering error", error);

    let errorElement: ReactNode = element;

    if (!errorElement && routerState?.onError) {
      try {
        const result = routerState.onError(error, routerState);
        if (result instanceof Redirection) {
          this.log.warn("Error handler returned Redirection but headers sent", {
            redirect: result.data.redirect,
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

    // Read without awaiting: this runs inside a stream controller callback.
    // Safe because an SSR error implies a render is under way, and a render
    // awaits the same module before opening the stream — see
    // ReactDomServerProvider.peek.
    const reactDomServer = this.reactDomServer.peek();
    if (!reactDomServer) {
      this.log.error(
        "SSR renderer not loaded while rendering an error; falling back to plain text",
      );
      return error.message;
    }

    try {
      return reactDomServer.renderToString(wrappedElement);
    } catch (renderError) {
      this.log.error("Failed to render error component", renderError);
      return error.message;
    }
  }
}

/**
 * A stream controller teeing into the page cache. See `tee`.
 */
interface TeeController extends ReadableStreamDefaultController<Uint8Array> {
  sink?: PageCacheSink;
}

/**
 * Shared hydration state serialized to a JSON script tag with id="__ssr".
 * The personal atoms travel apart, in id="__ssr_private".
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
