import type { Server } from "node:http";
import { $inject, type Alepha, AlephaError } from "alepha";
import { $logger } from "alepha/logger";
import { FileSystemProvider } from "alepha/system";
import { __alephaRef } from "../../core/helpers/ref.ts";
import { ConsoleColorProvider } from "../../logger/providers/ConsoleColorProvider.ts";
import type { AppEntry } from "./AppEntryProvider.ts";

export interface DevServerOptions {
  /**
   * Root directory of the project.
   */
  root: string;

  /**
   * Path to the server entry file.
   */
  entry: AppEntry;

  /**
   * Port to run the dev server on.
   */
  port?: number;

  /**
   * Host to bind the dev server to.
   */
  host?: string | boolean;
}

/**
 * Base class for development servers with Alepha integration.
 *
 * Architecture:
 * - Dev server runs in middleware mode (no HTTP server)
 * - Alepha is the HTTP server via server:onRequest event
 * - Request flow: Page requests → Alepha SSR, Assets → Dev server middleware
 *
 * HMR Strategy:
 * - Browser-only changes (CSS, client components) → Dev server HMR
 * - Server-only changes → Restart Alepha → Full browser reload
 * - Shared changes → Restart Alepha → Let HMR propagate
 *
 * Features:
 * - Automatic .env reload detection
 * - Error recovery on next file change
 * - Optimized module invalidation (only changed files + importers)
 */
export abstract class DevServerProvider {
  protected readonly log = $logger();
  protected readonly fs = $inject(FileSystemProvider);
  protected readonly colors = $inject(ConsoleColorProvider);
  protected nodeServer?: Server;
  protected options!: DevServerOptions;
  protected alepha: Alepha | null = null;
  protected hasError = false;
  protected changedFiles = new Set<string>();
  protected waitingForRetry = false;

  /**
   * Initialize the dev server and load Alepha.
   */
  public async init(options: DevServerOptions): Promise<Alepha> {
    this.options = options;
    await this.createServer();

    try {
      return await this.loadAlepha(true);
    } catch (err) {
      this.hasError = true;
      this.logError("Startup failed", err);
      this.alepha = null;
      return await this.waitForSuccessfulLoad();
    }
  }

  /**
   * Start the Alepha server.
   */
  public async start(): Promise<void> {
    try {
      await this.alepha?.start();
      if (!this.nodeServer) {
        this.nodeServer = this.alepha?.store.get("alepha.node.server");
      }
    } catch (err) {
      this.hasError = true;
      this.logError("Startup failed", err);
      this.alepha = null;
      this.alepha = await this.waitForSuccessfulLoad();
      await this.alepha.start();
    }
  }

  /**
   * Check if project uses React (by checking for ReactServerProvider).
   */
  public hasReact(): boolean {
    try {
      this.alepha?.inject("ReactServerProvider");
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Create the dev server in middleware mode.
   */
  protected abstract createServer(): Promise<void>;

  /**
   * Load or reload the Alepha instance.
   */
  protected abstract loadAlepha(isInitialLoad?: boolean): Promise<Alepha>;

  /**
   * Setup Alepha instance with dev server middleware.
   */
  protected abstract setupAlepha(): Promise<void>;

  /**
   * Send browser reload signal.
   */
  protected abstract sendBrowserReload(): void;

  /**
   * Fix stack trace for better error messages.
   */
  protected abstract fixStacktrace(error: Error): void;

  /**
   * Subscribe to file changes. Returns unsubscribe function.
   */
  protected abstract subscribeToFileChanges(
    onChange: (file: string) => void,
  ): () => void;

  /**
   * Run dev server middleware for a request.
   */
  protected abstract runMiddleware(req: any, res: any, next: () => void): void;

  /**
   * Wait for file changes and retry loading until successful.
   */
  protected waitForSuccessfulLoad(): Promise<Alepha> {
    this.waitingForRetry = true;

    return new Promise((resolve) => {
      const onFileChange = async (file: string) => {
        // Ignore IDE files
        if (/[/\\]\.idea[/\\]/.test(file)) return;

        console.log();
        console.log(this.colors.set("CYAN", "  ⟳ Retrying..."));
        this.changedFiles.add(file);

        try {
          const alepha = await this.loadAlepha(false);
          this.waitingForRetry = false;
          unsubscribe();
          resolve(alepha);
        } catch (err) {
          this.hasError = true;
          this.logError("Startup failed", err);
          this.alepha = null;
        }
      };

      const unsubscribe = this.subscribeToFileChanges(onFileChange);
    });
  }

  /**
   * Clear global Alepha references before reload.
   */
  protected clearAlephaRefs(): void {
    __alephaRef.alepha = undefined;
    __alephaRef.service = undefined;
    __alephaRef.parent = undefined;
    (globalThis as any).__alepha = undefined;
  }

  /**
   * Destroy the current Alepha instance.
   */
  protected async destroyAlepha(): Promise<void> {
    if (this.alepha) {
      await this.alepha
        .destroy()
        .catch((err) => this.log.warn("Error destroying Alepha", err));
      this.alepha = null;
    }
  }

  /**
   * Setup environment variables for dev mode.
   */
  protected setupDevEnvironment(): void {
    process.env.NODE_ENV ??= "development";
    process.env.VITE_ALEPHA_DEV = "true";
    process.env.SERVER_HOST ??= this.options.host?.toString() ?? "localhost";
    process.env.SERVER_PORT ??= String(
      this.options.port ??
        (process.env.SERVER_PORT ? Number(process.env.SERVER_PORT) : 3000),
    );
  }

  /**
   * Get the loaded Alepha instance from globalThis.
   */
  protected getLoadedAlepha(): Alepha {
    const alepha: Alepha = (globalThis as any).__alepha;
    if (!alepha) {
      throw new AlephaError(
        "Alepha instance not found after loading entry module",
      );
    }
    return alepha;
  }

  /**
   * Render error overlay when server fails to load.
   */
  protected renderErrorOverlay(err: Error): void {
    if (!this.nodeServer) return;

    // Only remove request listeners, keep connection tracking
    this.nodeServer.removeAllListeners("request");

    // Pre-render error HTML synchronously to avoid async issues
    const errorHtml = this.buildErrorHtml(err);

    this.nodeServer.on("request", (req: any, res: any) => {
      const url = req.url || "/";

      // Let dev server handle its own routes (HMR client, assets, etc.)
      if (this.isDevServerRoute(url)) {
        this.runMiddleware(req, res, () => {
          res.writeHead(404).end();
        });
        return;
      }

      // Serve error page for all other requests
      res.writeHead(500, { "Content-Type": "text/html" }).end(errorHtml);
    });

    this.sendBrowserReload();
  }

  /**
   * Check if URL is a dev server internal route.
   */
  protected isDevServerRoute(url: string): boolean {
    return url.startsWith("/@") || url.startsWith("/__vite");
  }

  /**
   * Build error HTML page.
   */
  protected buildErrorHtml(err: Error): string {
    // Escape HTML to prevent XSS
    const escaped = (s: string) =>
      s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

    // Build error block with cause chain (matches logErrorWithCause)
    const buildErrorBlock = (
      error: Error,
      depth = 0,
      delayBase = 0,
    ): string => {
      const name = error.name || "Error";
      const message = error.message || "Unknown error";
      const stackLines = error.stack?.split("\n").slice(1) ?? [];

      // Parse stack to extract file location
      const fileMatch = stackLines[0]?.match(/at\s+.*?\(?(\/[^:)]+):(\d+)/);
      const filePath = fileMatch?.[1];
      const lineNum = fileMatch?.[2];

      const isCause = depth > 0;
      const delay = delayBase + depth * 0.1;

      let html = `
    <div class="error-block${isCause ? " error-cause" : ""}" style="animation-delay: ${delay}s">
      ${isCause ? '<p class="error-caused-by">Caused by</p>' : ""}
      <h${isCause ? "2" : "1"} class="error-title">${escaped(name)}: ${escaped(message)}</h${isCause ? "2" : "1"}>
      ${
        filePath
          ? `<p class="error-file"><span class="error-file-path">${escaped(filePath.split("/").slice(0, -1).join("/"))}/</span><span class="error-file-name">${escaped(filePath.split("/").pop() ?? "")}</span>${lineNum ? `<span class="error-file-line">:${escaped(lineNum)}</span>` : ""}</p>`
          : ""
      }
      ${
        stackLines.length > 0
          ? `<div class="error-stack">
        ${stackLines.map((line) => `<p class="error-stack-line">${escaped(line)}</p>`).join("\n        ")}
      </div>`
          : ""
      }
    </div>`;

      // Recursively add cause chain
      if (error.cause instanceof Error) {
        html += buildErrorBlock(error.cause, depth + 1, delay);
      }

      return html;
    };

    const errorBlocks = buildErrorBlock(err);

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Build Error</title>
  <script type="module" src="/@vite/client"></script>
  <script type="module">
    if (import.meta.hot) {
      import.meta.hot.on('alepha:reload', () => window.location.reload());
    }
  </script>
  <style>
    *, *::before, *::after { box-sizing: border-box; }

    body {
      font-family: system-ui, -apple-system, sans-serif;
      background: #fafafa;
      color: #171717;
      margin: 0;
      min-height: 100svh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 2rem;
    }

    .error-container {
      max-width: 720px;
      width: 100%;
    }

    .error-label {
      font-size: 0.75rem;
      font-weight: 500;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: #a3a3a3;
      margin: 0 0 0.75rem;
      opacity: 0;
      animation: fadeSlideIn 0.4s cubic-bezier(0.22, 1, 0.36, 1) forwards;
    }

    .error-block {
      opacity: 0;
      animation: fadeSlideIn 0.4s cubic-bezier(0.22, 1, 0.36, 1) forwards;
    }

    .error-cause {
      margin-top: 1.5rem;
      padding-left: 1rem;
      border-left: 2px solid #e5e5e5;
    }

    .error-caused-by {
      font-size: 0.6875rem;
      font-weight: 500;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: #a3a3a3;
      margin: 0 0 0.5rem;
    }

    .error-title {
      font-size: clamp(1.125rem, 3vw, 1.375rem);
      font-weight: 600;
      letter-spacing: -0.02em;
      margin: 0;
      line-height: 1.3;
      color: #171717;
    }

    h1.error-title {
      font-size: clamp(1.25rem, 4vw, 1.5rem);
    }

    .error-file {
      margin-top: 0.625rem;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 0.8125rem;
      color: #525252;
    }

    .error-file-path {
      color: #a3a3a3;
    }

    .error-file-name {
      color: #171717;
      font-weight: 500;
    }

    .error-file-line {
      color: #525252;
    }

    .error-stack {
      background: #fff;
      border: 1px solid #e5e5e5;
      border-radius: 8px;
      padding: 0.875rem 1rem;
      margin-top: 1rem;
      overflow-x: auto;
    }

    .error-cause .error-stack {
      background: #fafafa;
    }

    .error-stack-line {
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 0.75rem;
      line-height: 1.7;
      color: #a3a3a3;
      white-space: pre;
      margin: 0;
    }

    .error-stack-line:first-child {
      color: #525252;
    }

    .error-footer {
      display: flex;
      align-items: center;
      gap: 0.375rem;
      margin-top: 2rem;
      font-size: 0.8125rem;
      color: #a3a3a3;
      opacity: 0;
      animation: fadeSlideIn 0.4s cubic-bezier(0.22, 1, 0.36, 1) 0.3s forwards;
    }

    .error-footer kbd {
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 0.6875rem;
      background: #f5f5f5;
      border: 1px solid #e5e5e5;
      border-radius: 4px;
      padding: 0.125rem 0.375rem;
      box-shadow: 0 1px 0 #d4d4d4;
    }

    @keyframes fadeSlideIn {
      from {
        opacity: 0;
        transform: translateY(10px);
      }
      to {
        opacity: 1;
        transform: translateY(0);
      }
    }

    @media (prefers-reduced-motion: reduce) {
      .error-label,
      .error-block,
      .error-footer {
        animation: none;
        opacity: 1;
      }
    }

    @media (prefers-color-scheme: dark) {
      body { background: #171717; color: #fafafa; }
      .error-title { color: #fafafa; }
      .error-file-name { color: #fafafa; }
      .error-cause { border-left-color: #404040; }
      .error-stack { background: #262626; border-color: #404040; }
      .error-cause .error-stack { background: #1f1f1f; }
      .error-stack-line:first-child { color: #d4d4d4; }
      .error-footer kbd { background: #262626; border-color: #404040; box-shadow: 0 1px 0 #525252; }
    }
  </style>
</head>
<body>
  <div class="error-container">
    <p class="error-label">Build Error</p>
    ${errorBlocks}
    <footer class="error-footer">
      <span>Save changes to reload</span>
      <kbd>⌘S</kbd>
    </footer>
  </div>
</body>
</html>`;
  }

  /**
   * Check if request is for an HTML page (not an asset).
   */
  protected isPageRequest(req: any): boolean {
    const url = req.url || "/";

    // Root and index.html are page requests
    if (url === "/" || url === "/index.html") return true;

    // Dev server internal routes
    if (this.isDevServerRoute(url)) return false;

    // Files with extensions are assets
    if (/\.\w+$/.test(url.split("?")[0])) return false;

    return true;
  }

  /**
   * Log a formatted error with stack trace.
   */
  protected logError(title: string, err: unknown): void {
    const c = this.colors;

    console.log();
    console.log(c.set("RED", `  ✗ ${title}`));
    this.logErrorWithCause(err);
    console.log();
    console.log(c.set("GREY_DARK", "    Waiting for file changes to retry..."));
    console.log();
  }

  /**
   * Log error message and stack, recursively logging cause if present.
   */
  protected logErrorWithCause(err: unknown, depth = 0): void {
    const error = err instanceof Error ? err : new Error(String(err));
    const indent = `    ${"  ".repeat(depth)}`;

    this.fixStacktrace(error);

    const name = error.name || "Error";
    const message = error.message || "Unknown error";
    const stackLines = error.stack?.split("\n").slice(1);

    console.log();
    if (depth > 0) {
      console.log(this.colors.set("GREY_DARK", `${indent}Caused by:`));
    }
    console.log(this.colors.set("WHITE_BOLD", `${indent + name}: ${message}`));
    if (stackLines?.length) {
      console.log();
      for (const line of stackLines) {
        console.log(`${indent}${this.colors.set("GREY_DARK", line)}`);
      }
    }

    if (error.cause) {
      this.logErrorWithCause(error.cause, depth + 1);
    }
  }
}
