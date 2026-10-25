import type { DeviceInfo } from "../interfaces/DeviceInfo.ts";
import { DeviceProvider } from "./DeviceProvider.ts";

/**
 * A device a spec describes.
 */
export class MemoryDeviceProvider extends DeviceProvider {
  public device: DeviceInfo = { platform: "ios", isVirtual: true };

  public override async info(): Promise<DeviceInfo> {
    return this.device;
  }
}
