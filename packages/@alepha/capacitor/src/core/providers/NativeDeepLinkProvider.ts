import type { PluginListenerHandle } from "@capacitor/core";

import { DeepLinkProvider } from "./DeepLinkProvider.ts";

/**
 * Deep links from `@capacitor/app`: the launch URL and `appUrlOpen`.
 *
 * The listener is added on `start`, before the launch URL is read on
 * `ready`, so a link that arrives in between is not lost; one that arrives
 * twice is handled once.
 */
export class NativeDeepLinkProvider extends DeepLinkProvider {
  protected handle?: PluginListenerHandle;

  protected override async launchUrl(): Promise<string | undefined> {
    const { App } = await import("@capacitor/app");
    return (await App.getLaunchUrl())?.url;
  }

  protected override async listen(): Promise<void> {
    const { App } = await import("@capacitor/app");
    this.handle = await App.addListener("appUrlOpen", (event) => {
      this.receive(event.url).catch((error) => {
        this.log.error("Could not open the link", error);
      });
    });
  }

  protected override async unlisten(): Promise<void> {
    await this.handle?.remove();
    this.handle = undefined;
  }
}
