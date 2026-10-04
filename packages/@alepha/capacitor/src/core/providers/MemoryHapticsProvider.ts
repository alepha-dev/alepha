import { HapticsProvider } from "./HapticsProvider.ts";

/**
 * Records every haptic a spec triggered.
 */
export class MemoryHapticsProvider extends HapticsProvider {
  public calls: string[] = [];

  public override async impact(style: "light" | "medium" | "heavy" = "medium") {
    this.calls.push(`impact:${style}`);
  }

  public override async notification(type: "success" | "warning" | "error") {
    this.calls.push(`notification:${type}`);
  }

  public override async selection() {
    this.calls.push("selection");
  }
}
