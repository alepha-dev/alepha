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

  // Button: a machined dial, a conic-gradient bezel around a hatched face.
  //
  // A stylesheet rather than inline styles, because the effect needs pseudo
  // states, a media query and layered gradients. The button is fixed to the
  // page bottom-left and owns the "alepha-dt-" prefix so it cannot collide
  // with the application's own class names.
  //
  // The three layers stack in one grid cell, and every one of them carries
  // position:relative. A transformed element paints in the positioned
  // layer group, so a rotating bezel with a static face covers the face
  // outright. Giving all three a position puts them back in DOM order.
  const style = document.createElement("style");
  style.textContent = \`
#alepha-devtools-btn {
  position: fixed;
  bottom: 16px;
  left: 16px;
  z-index: 99998;
  width: 44px;
  height: 44px;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: none;
  cursor: pointer;
  display: grid;
  place-items: center;
  font-size: 0;
  -webkit-tap-highlight-color: transparent;
  filter: drop-shadow(0 1px 1px rgba(0, 0, 0, 0.18))
    drop-shadow(0 6px 14px rgba(0, 0, 0, 0.22));
  transition:
    transform 0.28s cubic-bezier(0.2, 0.7, 0.3, 1),
    filter 0.28s ease;
}
#alepha-devtools-btn > * {
  grid-area: 1 / 1;
  position: relative;
}
#alepha-devtools-btn:hover {
  transform: translateY(-2px);
  filter: drop-shadow(0 2px 2px rgba(0, 0, 0, 0.2))
    drop-shadow(0 12px 26px rgba(0, 0, 0, 0.28));
}
#alepha-devtools-btn:active {
  transform: translateY(0) scale(0.96);
  transition-duration: 0.08s;
}
#alepha-devtools-btn:focus-visible {
  outline: 2px solid #3b82f6;
  outline-offset: 3px;
}

/* The bezel. The repeating layer is the machined facets, 16 of them; the
 * sweep underneath is the light, darkest at 12 o'clock and brightest at
 * 7. It stops short of white so the ring still reads as a full circle on a
 * light page instead of dissolving into it along the bottom. */
#alepha-devtools-btn .alepha-dt-bezel {
  width: 44px;
  height: 44px;
  border-radius: 50%;
  background:
    repeating-conic-gradient(from 0deg, rgba(255, 255, 255, 0.17) 0deg 0.6deg, rgba(0, 0, 0, 0) 0.6deg 22.5deg),
    conic-gradient(from 0deg, #101013, #35353c 55deg, #7c7c86 130deg, #b4b4bb 200deg, #8a8a93 250deg, #3c3c43 310deg, #101013);
  box-shadow: 0 0 0 0.5px rgba(0, 0, 0, 0.28);
  transition: transform 0.5s cubic-bezier(0.2, 0.7, 0.3, 1);
}
#alepha-devtools-btn:hover .alepha-dt-bezel {
  transform: rotate(-72deg);
}

/* The face stays light in both colour schemes: it is a dial, and a dark
 * face inside a dark bezel loses the ring entirely. */
#alepha-devtools-btn .alepha-dt-face {
  width: 34px;
  height: 34px;
  border-radius: 50%;
  background:
    repeating-linear-gradient(45deg, rgba(24, 24, 27, 0.075) 0 1px, rgba(0, 0, 0, 0) 1px 6px),
    repeating-linear-gradient(-45deg, rgba(24, 24, 27, 0.075) 0 1px, rgba(0, 0, 0, 0) 1px 6px),
    radial-gradient(125% 125% at 34% 26%, #fdfdfc, #efeeec 58%, #dcdbd8);
  box-shadow:
    inset 0 0 0 1px rgba(0, 0, 0, 0.06),
    inset 0 1px 3px rgba(0, 0, 0, 0.12);
}

/* Bezel and gear turn against each other: the one mechanical flourish. */
#alepha-devtools-btn .alepha-dt-glyph {
  display: grid;
  place-items: center;
  /* The bezel's own darkest value, so the cog reads as the same metal. */
  color: #27272a;
  transition:
    transform 0.5s cubic-bezier(0.2, 0.7, 0.3, 1),
    color 0.28s ease;
}
/* 72deg is not a multiple of the 45deg tooth pitch, so the turn is visible. */
#alepha-devtools-btn:hover .alepha-dt-glyph {
  transform: rotate(72deg);
  color: #101013;
}

@media (prefers-reduced-motion: reduce) {
  #alepha-devtools-btn,
  #alepha-devtools-btn .alepha-dt-bezel,
  #alepha-devtools-btn .alepha-dt-glyph {
    transition-duration: 0s;
  }
  #alepha-devtools-btn:hover .alepha-dt-bezel,
  #alepha-devtools-btn:hover .alepha-dt-glyph {
    transform: none;
  }
}
\`;
  document.head.appendChild(style);

  const btn = document.createElement("button");
  btn.id = "alepha-devtools-btn";
  btn.type = "button";
  btn.title = "Alepha DevTools";
  btn.setAttribute("aria-label", "Open Alepha DevTools");
  // A SOLID cog, not the lucide outline one. The bezel is a heavy machined
  // form, and next to it a 2px stroke scaled down to 16px renders at 1.33px
  // and reads as a hairline pencil drawing sitting on a metal part. A filled
  // silhouette carries the same mass as the bezel, so the two read as one
  // object. Eight teeth is the most this survives at 44px: ten merge into a
  // rosette. The tooth is a trapezoid from the root radius (7.9) to the tip
  // (10.6), flared at the base, and the corners are rounded by stroking the
  // fill colour with round joins rather than by an arc at every corner.
  // The evenodd fill rule is what opens the 3.7 hub hole, and the hole is
  // what keeps it legible as a cog rather than a blob.
  btn.innerHTML = \`<span class="alepha-dt-bezel"></span><span class="alepha-dt-face"></span><span class="alepha-dt-glyph"><svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="1.1" stroke-linejoin="round" fill-rule="evenodd" xmlns="http://www.w3.org/2000/svg"><path d="M9.975 4.364L10.096 1.572L13.904 1.572L14.025 4.364A7.9 7.9 0 0 1 15.968 5.169L18.027 3.28L20.72 5.973L18.831 8.032A7.9 7.9 0 0 1 19.636 9.975L22.428 10.096L22.428 13.904L19.636 14.025A7.9 7.9 0 0 1 18.831 15.968L20.72 18.027L18.027 20.72L15.968 18.831A7.9 7.9 0 0 1 14.025 19.636L13.904 22.428L10.096 22.428L9.975 19.636A7.9 7.9 0 0 1 8.032 18.831L5.973 20.72L3.28 18.027L5.169 15.968A7.9 7.9 0 0 1 4.364 14.025L1.572 13.904L1.572 10.096L4.364 9.975A7.9 7.9 0 0 1 5.169 8.032L3.28 5.973L5.973 3.28L8.032 5.169A7.9 7.9 0 0 1 9.975 4.364ZM12 8.3A3.7 3.7 0 0 0 12 15.7A3.7 3.7 0 0 0 12 8.3Z"/></svg></span>\`;

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
    // Empty string, not "flex": the stylesheet lays the dial out as a grid,
    // and an inline display would flatten its three stacked layers.
    btn.style.display = "";
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
 * "User removed the dependency but kept the plugin line" is a normal state,
 * not a broken install: every project `alepha init` scaffolded before #Q2280
 * carries both, and dropping one must not take down config load for the
 * whole project. The caller degrades to a no-op with a warning instead.
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
 * Opt-in: `alepha init` does not register it. Add `@alepha/devtools` as a
 * devDependency and the plugin to `alepha.config.ts`. If the package is
 * missing the plugin becomes a no-op rather than failing config load.
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
