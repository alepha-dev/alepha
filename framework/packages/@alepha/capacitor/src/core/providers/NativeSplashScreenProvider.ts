import { SplashScreenProvider } from "./SplashScreenProvider.ts";

/**
 * The splash through `@capacitor/splash-screen`, loaded on first use so a web
 * build never fetches the plugin.
 */
export class NativeSplashScreenProvider extends SplashScreenProvider {
  public override async hide(): Promise<void> {
    const { SplashScreen } = await import("@capacitor/splash-screen");
    await SplashScreen.hide();
  }
}
