import { SystemBars, SystemBarsStyle } from "@capacitor/core";

import { StatusBarProvider } from "./StatusBarProvider.ts";

/**
 * The status bar through Capacitor's own `SystemBars`.
 */
export class NativeStatusBarProvider extends StatusBarProvider {
  public override async setStyle(style: "light" | "dark" | "default") {
    const styles = {
      light: SystemBarsStyle.Light,
      dark: SystemBarsStyle.Dark,
      default: SystemBarsStyle.Default,
    };
    await SystemBars.setStyle({ style: styles[style] });
  }

  public override async show() {
    await SystemBars.show();
  }

  public override async hide() {
    await SystemBars.hide();
  }
}
