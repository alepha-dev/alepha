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
    }
  })();

  (window as any).alepha = alepha;

  return alepha;
};
