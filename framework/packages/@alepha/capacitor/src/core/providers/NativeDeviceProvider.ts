import type { DeviceInfo } from "../interfaces/DeviceInfo.ts";
import { DeviceProvider } from "./DeviceProvider.ts";

/**
 * Device information from `@capacitor/device`.
 */
export class NativeDeviceProvider extends DeviceProvider {
  public override async info(): Promise<DeviceInfo> {
    const { Device } = await import("@capacitor/device");
    const info = await Device.getInfo();
    return {
      platform: info.platform,
      model: info.model,
      manufacturer: info.manufacturer,
      osVersion: info.osVersion,
      isVirtual: info.isVirtual,
    };
  }
}
