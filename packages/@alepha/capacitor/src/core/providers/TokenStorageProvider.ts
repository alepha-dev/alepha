/**
 * Where a native app keeps its session tokens.
 *
 * The web implementation (this class) keeps nothing: a website's session
 * lives in cookies the server sets, and `ReactAuth` keeps using them. The
 * native one is the platform's secure store (iOS Keychain, Android Keystore)
 * through `@aparajita/capacitor-secure-storage`.
 */
export class TokenStorageProvider {
  public async get(_key: string): Promise<string | undefined> {
    return undefined;
  }

  public async set(_key: string, _value: string): Promise<void> {}

  public async remove(_key: string): Promise<void> {}
}
