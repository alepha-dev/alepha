import { TokenStorageProvider } from "./TokenStorageProvider.ts";

/**
 * Session tokens in the Keychain (iOS) or the Keystore (Android), through
 * `@aparajita/capacitor-secure-storage`, loaded on first use.
 */
export class NativeTokenStorageProvider extends TokenStorageProvider {
  public override async get(key: string): Promise<string | undefined> {
    const { SecureStorage } =
      await import("@aparajita/capacitor-secure-storage");
    return (await SecureStorage.getItem(key)) ?? undefined;
  }

  public override async set(key: string, value: string): Promise<void> {
    const { SecureStorage } =
      await import("@aparajita/capacitor-secure-storage");
    await SecureStorage.setItem(key, value);
  }

  public override async remove(key: string): Promise<void> {
    const { SecureStorage } =
      await import("@aparajita/capacitor-secure-storage");
    await SecureStorage.removeItem(key);
  }
}
