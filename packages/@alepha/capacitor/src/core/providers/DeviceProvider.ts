import type { DeviceInfo } from "../interfaces/DeviceInfo.ts";

/**
 * What the app runs on. The web implementation (this class) says only what a
 * browser can honestly say; the native one asks `@capacitor/device`.
 */
export class DeviceProvider {
  public async info(): Promise<DeviceInfo> {
    return {
      platform: "web",
      isVirtual: false,
      userAgent:
        typeof navigator === "undefined" ? undefined : navigator.userAgent,
    };
  }
}
