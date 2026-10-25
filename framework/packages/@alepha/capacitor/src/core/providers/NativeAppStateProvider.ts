import type { PluginListenerHandle } from "@capacitor/core";

import { AppStateProvider } from "./AppStateProvider.ts";

/**
 * Foreground and background from `@capacitor/app`, which a WebView's own
 * visibility events do not report reliably on either platform.
 */
export class NativeAppStateProvider extends AppStateProvider {
  protected handle?: PluginListenerHandle;

  protected override async listen(): Promise<void> {
    const { App } = await import("@capacitor/app");
    this.active = (await App.getState()).isActive;
    this.handle = await App.addListener("appStateChange", (state) => {
      void this.update(state.isActive);
    });
  }

  protected override async unlisten(): Promise<void> {
    await this.handle?.remove();
    this.handle = undefined;
  }
}
