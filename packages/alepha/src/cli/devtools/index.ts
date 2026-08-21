import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

import { $context, $module, AlephaError } from "alepha";
import { ViteDevServerProvider } from "alepha/cli";

import {
  type DevtoolsOptions,
  devtoolsOptions,
} from "./atoms/devtoolsOptions.ts";

// ---------------------------------------------------------------------------------------------------------------------

const DEVTOOLS_OVERLAY_SCRIPT = `
(function () {
  if (window.__alepha_devtools_injected) return;
  window.__alepha_devtools_injected = true;

  const STORAGE_KEY = "alepha-devtools-open";

  // Button
  const btn = document.createElement("button");
  btn.id = "alepha-devtools-btn";
  btn.innerHTML = \`<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" xmlns="http://www.w3.org/2000/svg"><path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z"/></svg>\`;
  Object.assign(btn.style, {
    position: "fixed", bottom: "16px", left: "16px", zIndex: "99998",
    width: "36px", height: "36px", borderRadius: "50%",
    background: "rgba(255,255,255,0.85)", color: "#3f3f46",
    border: "none", backdropFilter: "blur(8px)", WebkitBackdropFilter: "blur(8px)",
    cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
    boxShadow: "0 1px 2px rgba(0,0,0,0.06), 0 4px 12px rgba(0,0,0,0.08)",
    transition: "transform 0.2s ease, box-shadow 0.2s ease",
    padding: "0", fontSize: "0",
  });
  btn.addEventListener("mouseenter", () => {
    btn.style.transform = "translateY(-1px) rotate(45deg)";
    btn.style.boxShadow = "0 2px 4px rgba(0,0,0,0.08), 0 8px 20px rgba(0,0,0,0.12)";
  });
  btn.addEventListener("mouseleave", () => {
    btn.style.transform = "translateY(0) rotate(0deg)";
    btn.style.boxShadow = "0 1px 2px rgba(0,0,0,0.06), 0 4px 12px rgba(0,0,0,0.08)";
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
 * Locate the devtools UI assets shipped inside `@alepha/devtools`.
 *
 * Returns `undefined` rather than throwing when the package is absent.
 * `alepha init` wires `devtools()` into the generated config by default, so
 * "user removed the dependency but kept the plugin line" is a normal state,
 * not a broken install — and it must not take down config load for the whole
 * project. The caller degrades to a no-op with a warning instead.
 *
 * @param resolve injection seam for tests; defaults to Node resolution.
 */
export const resolveDevtoolsAssetsPath = (
  resolve: (specifier: string) => string = createRequire(import.meta.url)
    .resolve,
): string | undefined => {
  try {
    return join(dirname(resolve("@alepha/devtools/package.json")), "assets/ui");
  } catch {
    return undefined;
  }
};

/**
 * CLI plugin that integrates @alepha/devtools into the Vite dev server.
 *
 * This module is intentionally lightweight - it does NOT statically import
 * `@alepha/devtools` (which pulls in `alepha/react` and `.tsx` files).
 * Instead, it lazy-loads devtools via Vite's SSR module loader at runtime.
 *
 * Registered by default in configs generated by `alepha init`; opt out with
 * `alepha init --no-devtools`. If the package is missing the plugin becomes
 * a no-op rather than failing config load.
 *
 * Usage in `alepha.config.ts`:
 * ```ts
 * import { devtools } from "alepha/cli/devtools";
 *
 * export default defineConfig({
 *   plugins: [devtools()],
 * });
 * ```
 *
 * @module alepha.devtools.plugin
 */
export const AlephaCliDevtoolsPlugin = $module({
  name: "alepha.cli.plugins.devtools",
  atoms: [devtoolsOptions],
  register: (alepha) => {
    const assetsPath = resolveDevtoolsAssetsPath();
    if (!assetsPath) {
      console.warn(
        "[alepha] devtools() is configured but '@alepha/devtools' is not installed — skipping. Install it, or remove devtools() from alepha.config.ts.",
      );
      return;
    }

    const vite = alepha.inject(ViteDevServerProvider) as ViteDevServerProvider;

    process.env.VITE_ALEPHA_DEVTOOLS = "true";

    vite.addVitePlugin({
      name: "alepha-devtools",
      configureServer: (server) => {
        // Reload endpoint
        server.middlewares.use((req, res, next) => {
          if (req.url !== "/__devtools/api/reload" || req.method !== "POST") {
            return next();
          }

          vite.reload();
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ ok: true }));
        });

        // Serve devtools HTML
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

export const devtools = (options: DevtoolsOptions = {}) => {
  return () => {
    const { alepha } = $context();
    alepha.with(AlephaCliDevtoolsPlugin).set(devtoolsOptions, options);
  };
};

// ---------------------------------------------------------------------------------------------------------------------

export * from "./atoms/devtoolsOptions.ts";
