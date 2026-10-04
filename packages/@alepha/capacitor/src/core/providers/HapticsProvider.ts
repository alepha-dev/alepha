/**
 * Touch feedback. A no-op on the web, where there is nothing to vibrate
 * reliably; the native implementation drives `@capacitor/haptics`.
 */
export class HapticsProvider {
  /**
   * A physical tap, for a confirmed action.
   */
  public async impact(_style: "light" | "medium" | "heavy" = "medium") {}

  /**
   * The outcome of something the user did.
   */
  public async notification(_type: "success" | "warning" | "error") {}

  /**
   * A selection moved, as in a picker.
   */
  public async selection() {}
}
