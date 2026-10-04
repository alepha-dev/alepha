import { AlephaError } from "alepha";

/**
 * Registers the app's custom URL scheme in the two native projects.
 *
 * iOS declares it in `Info.plist` (`CFBundleURLTypes`), Android in an
 * intent filter on the main activity. Both edits are narrow text inserts at
 * one anchor that `cap add` lays down; anything else in either file is the
 * user's and is never rewritten. When the anchor is not where `cap add` puts
 * it, or the file already declares URL types of its own, the edit is refused
 * with the exact lines to add by hand rather than guessed at.
 */
export class NativeSchemes {
  /**
   * `Info.plist` with the scheme registered, or `null` when it already is.
   */
  public registerIos(
    plist: string,
    scheme: string,
    appId: string,
  ): string | null {
    if (this.iosDeclares(plist, scheme)) {
      return null;
    }

    const block = this.iosBlock(scheme, appId);

    if (plist.includes("<key>CFBundleURLTypes</key>")) {
      throw new AlephaError(
        `ios/App/App/Info.plist already declares CFBundleURLTypes without the scheme "${scheme}". Add this entry to its array by hand:\n${this.iosEntry(scheme, appId)}`,
      );
    }

    const anchor = /\n<\/dict>\s*\n<\/plist>\s*$/;
    if (!anchor.test(plist)) {
      throw new AlephaError(
        `ios/App/App/Info.plist does not end the way \`cap add ios\` writes it. Add this inside its top-level <dict> by hand:\n${block}`,
      );
    }

    return plist.replace(anchor, (end) => `\n${block}${end}`);
  }

  /**
   * `AndroidManifest.xml` with the scheme registered, or `null` when it
   * already is.
   */
  public registerAndroid(manifest: string, scheme: string): string | null {
    if (manifest.includes(`android:scheme="${scheme}"`)) {
      return null;
    }

    const filter = this.androidFilter(scheme);
    const launcher =
      /(<category android:name="android\.intent\.category\.LAUNCHER"\s*\/>\s*<\/intent-filter>)/g;
    const matches = manifest.match(launcher) ?? [];

    if (matches.length !== 1) {
      throw new AlephaError(
        `android/app/src/main/AndroidManifest.xml does not have the one launcher activity \`cap add android\` writes. Add this intent filter to the activity that should open "${scheme}://" links by hand:\n${filter}`,
      );
    }

    return manifest.replace(launcher, (found) => `${found}\n\n${filter}`);
  }

  /**
   * Whether `Info.plist` already lists the scheme among its URL schemes.
   */
  public iosDeclares(plist: string, scheme: string): boolean {
    const types = plist.indexOf("<key>CFBundleURLTypes</key>");
    return (
      types >= 0 && plist.slice(types).includes(`<string>${scheme}</string>`)
    );
  }

  protected iosEntry(scheme: string, appId: string): string {
    return [
      "\t\t<dict>",
      "\t\t\t<key>CFBundleURLName</key>",
      `\t\t\t<string>${appId}</string>`,
      "\t\t\t<key>CFBundleURLSchemes</key>",
      "\t\t\t<array>",
      `\t\t\t\t<string>${scheme}</string>`,
      "\t\t\t</array>",
      "\t\t</dict>",
    ].join("\n");
  }

  protected iosBlock(scheme: string, appId: string): string {
    return [
      "\t<key>CFBundleURLTypes</key>",
      "\t<array>",
      this.iosEntry(scheme, appId),
      "\t</array>",
    ].join("\n");
  }

  protected androidFilter(scheme: string): string {
    return [
      "            <intent-filter>",
      '                <action android:name="android.intent.action.VIEW" />',
      '                <category android:name="android.intent.category.DEFAULT" />',
      '                <category android:name="android.intent.category.BROWSABLE" />',
      `                <data android:scheme="${scheme}" />`,
      "            </intent-filter>",
    ].join("\n");
  }
}
