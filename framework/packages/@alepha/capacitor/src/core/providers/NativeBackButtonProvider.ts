import type { PluginListenerHandle } from "@capacitor/core";

import { BackButtonProvider } from "./BackButtonProvider.ts";

/**
 * The hardware back button from `@capacitor/app` (Android; iOS has none).
 */
export class NativeBackButtonProvider extends BackButtonProvider {
  protected handle?: PluginListenerHandle;

  protected override async listen(): Promise<void> {
    const { App } = await import("@capacitor/app");
    this.handle = await App.addListener("backButton", () => {
      void this.press();
    });
  }

  protected override async unlisten(): Promise<void> {
    await this.handle?.remove();
    this.handle = undefined;
  }

  protected override async exit(): Promise<void> {
    const { App } = await import("@capacitor/app");
    await App.exitApp();
  }
}
