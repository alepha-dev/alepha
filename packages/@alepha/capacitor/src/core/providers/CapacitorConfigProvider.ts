import { $hook, $inject, Alepha } from "alepha";
import { linkOptionsAtom } from "alepha/server/links";

import type { CapacitorPublicConfig } from "../schemas/capacitorPublicConfigSchema.ts";

/**
 * The public configuration of a native shell, as its build baked it.
 *
 * `alepha capacitor sync`, `build` and `dev` hand it to the client bundle as
 * the Vite `define` `__ALEPHA_CAPACITOR__`. A web build never defines it, and
 * its absence is how the rest of `@alepha/capacitor/core` knows it runs in a
 * plain website: nothing it configures then changes.
 *
 * On `configure` it points every host-less `$client` at the shell's API: the
 * WebView's own origin (`capacitor://localhost`, `https://localhost`) serves
 * the shell and nothing else.
 */
export class CapacitorConfigProvider {
  protected readonly alepha = $inject(Alepha);

  protected readonly onConfigure = $hook({
    on: "configure",
    handler: () => {
      const apiUrl = this.get()?.apiUrl;
      if (!apiUrl) {
        return;
      }
      this.alepha.store.mut(linkOptionsAtom, (options) => ({
        ...options,
        hostname: apiUrl,
      }));
    },
  });

  /**
   * The baked configuration, or `undefined` outside a capacitor-built shell.
   */
  public get(): CapacitorPublicConfig | undefined {
    return this.read();
  }

  /**
   * Whether this bundle was built by the capacitor CLI, native or opened in a
   * browser.
   */
  public isShell(): boolean {
    return this.get() !== undefined;
  }

  /**
   * Read the define. Behind a method so a spec substitutes the answer, since
   * only a Vite build can define the constant.
   */
  protected read(): CapacitorPublicConfig | undefined {
    return typeof __ALEPHA_CAPACITOR__ === "undefined"
      ? undefined
      : __ALEPHA_CAPACITOR__;
  }
}

declare global {
  /**
   * Defined by the capacitor CLI's builds and dev server only.
   */
  const __ALEPHA_CAPACITOR__: CapacitorPublicConfig | undefined;
}
