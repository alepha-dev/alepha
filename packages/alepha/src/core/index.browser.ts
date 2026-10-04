import { Alepha } from "./Alepha.ts";
import type { RunOptions } from "./interfaces/Run.ts";
import type { Service } from "./interfaces/Service.ts";

export * from "./index.shared.ts";

export const run = (
  entry: Alepha | Service | Array<Service>,
  opts?: RunOptions,
): Alepha => {
  const alepha =
    entry instanceof Alepha ? entry : Alepha.create({ env: { ...opts?.env } });

  if (!(entry instanceof Alepha)) {
    const entries = Array.isArray(entry) ? entry : [entry];
    for (const e of entries) {
      alepha.with(e);
    }
  }

  // if (import.meta?.hot) {
  //   import.meta.hot.on("alepha:reload", async () => {
  //     window.location.reload();
  //   });
  // }

  void (async () => {
    try {
      await opts?.configure?.(alepha);

      await alepha.start();

      if (opts?.ready) {
        await opts.ready(alepha);
      }
    } catch (error) {
      alepha.log?.error("Alepha failed to start", error);

      // A page left blank says nothing, and inside a native shell it is all
      // the user sees once the splash is gone. Plain DOM, no React: whatever
      // failed may be the renderer. A page that already shows something (a
      // server-rendered one) is left alone.
      const body = typeof document === "undefined" ? undefined : document.body;
      if (body && !body.innerText?.trim() && !body.textContent?.trim()) {
        const box = document.createElement("div");
        box.setAttribute("data-alepha-start-failed", "");
        box.setAttribute("role", "alert");
        box.style.cssText =
          "font-family:system-ui,sans-serif;padding:24px;text-align:center;";
        const message = document.createElement("p");
        message.textContent = "The app could not start.";
        const reload = document.createElement("button");
        reload.type = "button";
        reload.textContent = "Reload";
        reload.addEventListener("click", () => window.location.reload());
        box.append(message, reload);
        body.append(box);
      }
    }
  })();

  (window as any).alepha = alepha;

  return alepha;
};
