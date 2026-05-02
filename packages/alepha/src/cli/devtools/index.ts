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
  btn.innerHTML = \`<svg width="28" height="28" viewBox="0 0 300 300" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="adb" x1="142.3" x2="159.6" y1="123.3" y2="176.7" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#33a72c"/><stop offset="1" stop-color="#2d8d40"/></linearGradient><linearGradient id="adc" x1="61.6" x2="100.7" y1="218.5" y2="174" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#298e35"/><stop offset="1" stop-color="#327952"/></linearGradient><linearGradient id="add" x1="262.7" x2="242.2" y1="178.4" y2="220.1" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#32a62d"/><stop offset="1" stop-color="#2d8d40"/></linearGradient><linearGradient id="ade" x1="81.2" x2="69.1" y1="126.7" y2="92.3" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#299a2c"/><stop offset="1" stop-color="#51be40"/></linearGradient><clipPath id="ada"><path fill="none" d="M0 0h300v241H0z"/></clipPath></defs><g fill="none" stroke-miterlimit="10" clip-path="url(#ada)"><path fill="url(#adb)" d="M54 174a182 182 0 0 1 106-51c19-2 37-6 54-15l16-11 3-4 1 1 1 4 1 6v9c0 6-2 12-5 18l-1 4-7 8c-5 7-12 14-19 19l-4 2-11 7v1l-1-1-3 2a120 120 0 0 1-30 8l-8 1-20-1c-21-3-44-10-64 0-5 2-9 4-12 8l-9 9h1l14-9c7-4 15-6 23-7h7l25 3 3 1-2 5-3 5c-4 7-10 14-15 18l-4 3c-12 8-25 12-39 13h-5l-5 1h-8l-7-1H15c0-3 4-7 5-9l7-11 5-8c6-10 14-19 22-28z"/><path fill="#1d524a" d="M178 141c9-1 17-4 24-8l8-4-6 4c-9 7-20 11-32 13l-39 5h-5l-15 3 16 13 18 15-20-1c-21-3-44-10-64 0-5 2-9 4-12 8l-9 9h1l14-9c7-4 15-6 23-7h7l25 3 3 1-2 5-3 5c-4 7-10 14-15 18l-4 3c-12 8-25 12-39 13h-5l-5 1h-8l-7-1H15c0-3 4-7 5-9l7-11 5-8c6-10 14-19 22-28l4-2 23-14 11-5c21-7 43-9 65-9l21-3z"/><path fill="url(#adc)" d="M57 189c7-4 15-6 23-7h7l25 3 3 1-2 5-3 5c-4 7-10 14-15 18l-4 3c-12 8-25 12-39 13h-5l-4-9-2-5 5-2 9-4 10-5 10-4c5-2 10-3 14-6l3-1h-1a1136 1136 0 0 0-43 14c1-6 6-14 9-19 1 0 0 0 0 0z"/><path fill="#2d6f4d" d="m41 216 5-2 9-4 5 3c9 4 18 6 27 4h4c-12 8-25 12-39 13h-5l-4-9-2-5zm16-27s1 0 0 0c-3 5-8 13-9 19l-15 8c0-3 1-9 3-11l3-3 4-4 14-9z"/><path fill="#49b63b" d="M42 198h1l-4 4 3-4z"/><path fill="#2d6f4d" d="m113 154 15-3 11 2 18 8c11 6 23 8 35 5l8-2-11 7v1l-1-1-3 2a120 120 0 0 1-30 8l-8 1-18-15-16-13z"/><path fill="#49b63b" d="M81 158c2-4 11-7 15-8 18-6 36-7 55-8l12-1h15l-21 3c-22 0-44 2-65 9l-11 5z"/><path fill="#2d913b" d="m110 52 2-5 9-14c7-8 19-14 29-18l10-3 12-6 1-1 1 1 1 5v6l6 12 5 10 12 26 2 5 4 10 7 17 4 8c-9 5-20 9-30 12l-16 3-7-14-6-14-5-10-1-3-4 7-13 27-6 11-6 2-24 9 2-4c11-16 14-36 11-56l-3 1-9 5 1-3 9-21 2-5z"/><path fill="#2d6f4d" d="m175 17 6 12 5 10 12 26 2 5 4 10 7 17 4 8c-9 5-20 9-30 12l-16 3-7-14-6-14-5-10-1-3c0-2 5-8 6-10l1-2c9-13 17-28 18-45v-5z"/><path fill="#1d524a" d="m175 17 6 12 5 10 12 26 2 5-3-1-13-8-7 4 3 7-4 1-2-3-5-12-5 7a136 136 0 0 1-10 15l-3 2-1-3c0-2 5-8 6-10l1-2c9-13 17-28 18-45v-5z"/><path fill="#2d6f4d" d="m186 39 12 26 2 5-3-1-13-8-7 4-6-12 8-7 7-7z"/><path fill="#2d913b" d="m177 65 7-4 13 8 3 1 4 10-3 7-7 14-2 8-1-4-6-19a99 99 0 0 0-8-21zm-3 5 2 3 12 32h-1l-8 5c-4 1-9 0-13-2l-1-1c-1-8 2-15 4-22 1-5 2-10 5-15z"/><path fill="#1d524a" d="m110 52 2-5 9-14c7-8 19-14 29-18l10-3 12-6 1-1 1 1c-3 1-3 2-4 4l-11 14-5 5v1c-11 11-22 24-31 37l-5 6-6 11h1l6 12c3 7 8 13 14 17l-6 11-6 2-24 9 2-4c11-16 14-36 11-56l-3 1-9 5 1-3 9-21 2-5z"/><path fill="#49b63b" d="m110 52 2-5 9-14c7-8 19-14 29-18l10-3 12-6 1-1 1 1c-3 1-3 2-4 4l-11 14-5 5-8 7-13 11-5 6c-5-2-10-5-15-3l-3 2z"/><path fill="#2d913b" d="m110 52 3-2c5-2 10 1 15 3l-12 13-6 9-3 1-9 5 1-3 9-21 2-5z"/><path fill="#2d6f4d" d="M121 92c10-5 19-9 28-17l7-6c-1 2-6 8-6 10l-4 7-13 27c-6-4-11-10-14-17l-6-12 4-5 4 13z"/><path fill="#49b63b" d="m154 30-1 11c0 4-3 9-6 12-6 9-19 10-25 19-1 0-3 2-4 1l5-6c9-13 20-26 31-37z"/><path fill="url(#add)" d="m230 135 3 6 11 17 2 5 4 5 3 6 9 14 19 36 4 5c-2 2-19 2-22 2l-5-1h-2c-12 0-25-4-35-10l-4-3c-10-8-15-16-21-27l-7-18v-1l11-7 4-2c7-5 14-12 19-19l7-8z"/><path fill="#1d524a" d="m230 135 3 6 11 17 2 5 4 5 3 6h-1c-10-8-20-9-32-4l23 23 13 12 1 2-20-14-13-12-4-3-5-6c-2 0-2 3-2 5l-1 10c-1 8-2 11 1 19l2 6 2 5c-10-8-15-16-21-27l-7-18v-1l11-7 4-2c7-5 14-12 19-19l7-8z"/><path fill="#2d6f4d" d="m233 141 11 17 2 5 4 5 3 6h-1c-10-8-20-9-32-4l-7-9 15-15 5-5zm-16 76-2-5-2-6c-3-8-2-11-1-19l1-10c0-2 0-5 2-5l5 6 4 3h-1c0 4 8 22 11 26 6 10 15 18 25 22 2 0 3 0 4 2l-5-1h-2c-12 0-25-4-35-10l-4-3z"/><path fill="#2d913b" d="M110 75c3 20 0 40-11 56l-2 4a145 145 0 0 0-43 31l-5 4-11 15v-7l-1-10a143 143 0 0 1 5-29l9-20c13-18 32-29 52-37l4-3 3-4z"/><path fill="url(#ade)" d="m42 139 9-20c13-18 32-29 52-37l4-3-3 7c-4 5-8 11-13 15l-3 3c-6 6-13 12-18 19l-8 11-20 5z"/><path fill="#1d524a" d="M91 101c0 2-4 6-6 8-5 5-10 11-14 18l-9 13-4 9 5 1c4 0 16-9 19-7-10 7-20 14-28 23l-5 4-11 15v-7l-1-10a143 143 0 0 1 5-29l20-5 8-11c5-7 12-13 18-19l3-3z"/><path fill="#2d6f4d" d="m62 134-9 16-3 7-2 4c-3 3-8 5-10 8l-1-1a143 143 0 0 1 5-29l20-5zm0 6 11-5 7-4c5-1 14-2 19 0l-2 4-15 8c-3-2-15 7-19 7l-5-1 4-9z"/></g></svg>\`;
  Object.assign(btn.style, {
    position: "fixed", bottom: "16px", left: "16px", zIndex: "99998",
    width: "40px", height: "40px", borderRadius: "50%",
    background: "#fff", border: "1px solid #2a2a4a",
    cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
    boxShadow: "0 2px 8px rgba(0,0,0,0.3)", transition: "all 0.2s",
    padding: "0", fontSize: "0",
  });
  btn.addEventListener("mouseenter", () => {
    btn.style.transform = "scale(1.1)";
  });
  btn.addEventListener("mouseleave", () => {
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
    const vite = alepha.inject(ViteDevServerProvider) as ViteDevServerProvider;

    const require = createRequire(import.meta.url);
    const pkgPath = require.resolve("@alepha/devtools/package.json");
    const assetsPath = join(dirname(pkgPath), "assets/ui");

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
