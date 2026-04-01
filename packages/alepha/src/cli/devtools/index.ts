import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { $module, AlephaError } from "alepha";
import { ViteDevServerProvider } from "alepha/cli";
import { devtoolsOptions } from "./atoms/devtoolsOptions.ts";

// ---------------------------------------------------------------------------------------------------------------------

const DEVTOOLS_OVERLAY_SCRIPT = `
(function () {
  if (window.__alepha_devtools_injected) return;
  window.__alepha_devtools_injected = true;

  const STORAGE_KEY = "alepha-devtools-open";

  // Button
  const btn = document.createElement("button");
  btn.id = "alepha-devtools-btn";
  btn.innerHTML = \`<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z"/><path d="m14.7 6.3-5.4 5.4a2.1 2.1 0 1 0 3 3l5.4-5.4a2.1 2.1 0 1 0-3-3z"/><path d="m8 16 1.5-1.5"/></svg>\`;
  Object.assign(btn.style, {
    position: "fixed", bottom: "16px", right: "16px", zIndex: "99998",
    width: "40px", height: "40px", borderRadius: "50%",
    background: "#1a1a2e", color: "#a0a0c0", border: "1px solid #2a2a4a",
    cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
    boxShadow: "0 2px 8px rgba(0,0,0,0.3)", transition: "all 0.2s",
    padding: "0", fontSize: "0",
  });
  btn.addEventListener("mouseenter", () => {
    btn.style.background = "#2a2a4e";
    btn.style.color = "#c0c0e0";
    btn.style.transform = "scale(1.1)";
  });
  btn.addEventListener("mouseleave", () => {
    btn.style.background = "#1a1a2e";
    btn.style.color = "#a0a0c0";
    btn.style.transform = "scale(1)";
  });

  // Overlay
  const overlay = document.createElement("div");
  overlay.id = "alepha-devtools-overlay";
  Object.assign(overlay.style, {
    position: "fixed", inset: "0", zIndex: "99999",
    background: "rgba(0,0,0,0.6)", backdropFilter: "blur(2px)",
    display: "none", alignItems: "center", justifyContent: "center",
  });

  // Panel
  const panel = document.createElement("div");
  Object.assign(panel.style, {
    width: "90vw", height: "85vh", maxWidth: "1400px",
    borderRadius: "12px", overflow: "hidden",
    boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
    border: "1px solid #2a2a4a",
  });

  const iframe = document.createElement("iframe");
  iframe.style.cssText = "width:100%;height:100%;border:none;";

  panel.appendChild(iframe);
  overlay.appendChild(panel);
  document.body.appendChild(btn);
  document.body.appendChild(overlay);

  function open() {
    if (!iframe.src) iframe.src = "/__devtools/";
    overlay.style.display = "flex";
    btn.style.display = "none";
    sessionStorage.setItem(STORAGE_KEY, "1");
  }

  function close() {
    overlay.style.display = "none";
    btn.style.display = "flex";
    sessionStorage.removeItem(STORAGE_KEY);
  }

  btn.addEventListener("click", open);
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) close();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && overlay.style.display === "flex") close();
  });

  // Restore state after HMR
  if (sessionStorage.getItem(STORAGE_KEY)) open();
})();
`;

/**
 * CLI plugin that integrates @alepha/devtools into the Vite dev server.
 *
 * This module is intentionally lightweight — it does NOT statically import
 * `@alepha/devtools` (which pulls in `alepha/react` and `.tsx` files).
 * Instead, it lazy-loads devtools via Vite's SSR module loader at runtime.
 *
 * Usage in `alepha.config.ts`:
 * ```ts
 * import { AlephaCliDevtoolsPlugin } from "alepha/devtools/plugin";
 *
 * export default defineConfig({
 *   services: [AlephaCliDevtoolsPlugin],
 * });
 * ```
 *
 * @module alepha.devtools.plugin
 */
export const AlephaCliDevtoolsPlugin = $module({
  name: "alepha.cli.plugins.devtools",
  atoms: [devtoolsOptions],
  register: (alepha) => {
    const vite = alepha.inject(ViteDevServerProvider) as ViteDevServerProvider;

    const require = createRequire(import.meta.url);
    const pkgPath = require.resolve("@alepha/devtools/package.json");
    const assetsPath = join(dirname(pkgPath), "assets/ui");

    process.env.VITE_ALEPHA_DEVTOOLS = "true";

    vite.addVitePlugin({
      name: "alepha-devtools",
      configureServer: (server) => {
        server.middlewares.use(async (req, res, next) => {
          const url = req.url || "/";

          if (
            !url.startsWith("/__devtools") ||
            !req.headers.accept?.includes("text/html")
          ) {
            return next();
          }

          const indexPath = join(assetsPath, "index.html");

          try {
            let html = await readFile(indexPath, "utf-8");
            html = html.replace(
              "<head>",
              `<head><script type="module" src="/@vite/client"></script>`,
            );

            res.writeHead(200, { "content-type": "text/html" });
            res.end(html);
          } catch {
            next();
          }
        });
      },
      transformIndexHtml: () => {
        const options = alepha.store.get(devtoolsOptions);
        if (options?.hideButton) return [];

        return [
          {
            tag: "script",
            attrs: { type: "module" },
            children: DEVTOOLS_OVERLAY_SCRIPT,
            injectTo: "head",
          },
        ];
      },
    });

    vite.onAlephaLoaded(async (appAlepha, server) => {
      try {
        const mod = await server.ssrLoadModule("@alepha/devtools");
        appAlepha.with(mod.AlephaDevtools);
      } catch (err) {
        throw new AlephaError(
          "Failed to load @alepha/devtools. Make sure the package is installed",
          { cause: err },
        );
      }
    });
  },
});

// ---------------------------------------------------------------------------------------------------------------------

export * from "./atoms/devtoolsOptions.ts";
