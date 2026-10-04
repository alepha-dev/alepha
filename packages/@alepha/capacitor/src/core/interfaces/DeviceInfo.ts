/**
 * The device an app runs on, as far as it can be known.
 */
export interface DeviceInfo {
  platform: "ios" | "android" | "web";
  model?: string;
  manufacturer?: string;
  osVersion?: string;
  /**
   * True on a simulator or an emulator.
   */
  isVirtual: boolean;
  /**
   * The browser's user agent, on the web only.
   */
  userAgent?: string;
}
