import { HapticsProvider } from "./HapticsProvider.ts";

/**
 * Haptics through `@capacitor/haptics`, loaded on first use so a web build
 * never fetches the plugin.
 */
export class NativeHapticsProvider extends HapticsProvider {
  public override async impact(style: "light" | "medium" | "heavy" = "medium") {
    const { Haptics, ImpactStyle } = await import("@capacitor/haptics");
    const styles = {
      light: ImpactStyle.Light,
      medium: ImpactStyle.Medium,
      heavy: ImpactStyle.Heavy,
    };
    await Haptics.impact({ style: styles[style] });
  }

  public override async notification(type: "success" | "warning" | "error") {
    const { Haptics, NotificationType } = await import("@capacitor/haptics");
    const types = {
      success: NotificationType.Success,
      warning: NotificationType.Warning,
      error: NotificationType.Error,
    };
    await Haptics.notification({ type: types[type] });
  }

  public override async selection() {
    const { Haptics } = await import("@capacitor/haptics");
    await Haptics.selectionStart();
    await Haptics.selectionChanged();
    await Haptics.selectionEnd();
  }
}
