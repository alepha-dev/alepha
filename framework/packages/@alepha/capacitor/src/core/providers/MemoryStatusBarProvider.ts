import { StatusBarProvider } from "./StatusBarProvider.ts";

/**
 * Records what a spec asked of the status bar.
 */
export class MemoryStatusBarProvider extends StatusBarProvider {
  public style?: "light" | "dark" | "default";
  public visible = true;

  public override async setStyle(style: "light" | "dark" | "default") {
    this.style = style;
  }

  public override async show() {
    this.visible = true;
  }

  public override async hide() {
    this.visible = false;
  }
}
