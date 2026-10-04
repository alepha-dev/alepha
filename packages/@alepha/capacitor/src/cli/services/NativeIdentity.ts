import { $inject, AlephaError } from "alepha";
import { $logger } from "alepha/logger";
import { FileSystemProvider } from "alepha/system";

import type {
  CapacitorOptions,
  CapacitorPlatform,
} from "../atoms/capacitorOptions.ts";
import { CapacitorProject } from "./CapacitorProject.ts";
import { NativeAssets } from "./NativeAssets.ts";
import { NativeSchemes } from "./NativeSchemes.ts";

/**
 * Writes the selected identity into the one pair of native projects: what
 * makes a variant another installable app.
 *
 * A narrow, in-house writer rather than Trapeze: it owns a fixed list of
 * settings in the files `cap add` lays down (Capacitor 8, iOS on SPM), and
 * nothing else in them:
 *
 * - iOS: `PRODUCT_BUNDLE_IDENTIFIER` in `project.pbxproj`, and in
 *   `Info.plist` the `CFBundleDisplayName` and the one URL type the plugin
 *   registers;
 * - Android: `applicationId` in `app/build.gradle` (the Java `namespace`
 *   stays, it names the code, not the app), the four identity strings of
 *   `res/values/strings.xml`, and the one `VIEW`/`BROWSABLE` intent filter
 *   the plugin registers;
 * - `capacitor.config.ts`, and the icons and splash ({@link NativeAssets}).
 *
 * Each setting is replaced where the template puts it, found by a pattern
 * that must match exactly as often as the template has it. A project that
 * does not look like that (a CocoaPods iOS project, a second bundle id, URL
 * types or intent filters of the user's own) is refused before anything is
 * written. Every file is computed first, then written; a failure while
 * writing puts every touched file back. Writing the same identity twice
 * writes nothing, and x, y, x leaves the files as x left them.
 */
export class NativeIdentity {
  protected readonly log = $logger();
  protected readonly fs = $inject(FileSystemProvider);
  protected readonly project = $inject(CapacitorProject);
  protected readonly schemes = $inject(NativeSchemes);
  protected readonly assets = $inject(NativeAssets);

  /**
   * Write the identity into the native projects that exist.
   */
  public async apply(
    root: string,
    options: CapacitorOptions,
    platforms: CapacitorPlatform[],
  ): Promise<void> {
    const present: CapacitorPlatform[] = [];
    for (const platform of platforms) {
      if (await this.fs.exists(this.project.platformDir(root, platform))) {
        present.push(platform);
      }
    }

    // Everything is computed, and so refused, before the first write.
    const edits: Array<{ path: string; content: string }> = [];
    if (present.includes("ios")) {
      edits.push(...(await this.iosEdits(root, options)));
    }
    if (present.includes("android")) {
      edits.push(...(await this.androidEdits(root, options)));
    }

    const touched = [
      ...edits.map((edit) => edit.path),
      this.project.configPath(root),
      ...(options.icon
        ? this.assets.outputs(present).map((path) => this.fs.join(root, path))
        : []),
    ];
    const originals = new Map<string, Buffer | undefined>();
    for (const path of touched) {
      originals.set(
        path,
        (await this.fs.exists(path)) ? await this.fs.readFile(path) : undefined,
      );
    }

    try {
      for (const edit of edits) {
        const current = originals.get(edit.path)?.toString("utf-8");
        if (current !== edit.content) {
          await this.fs.writeFile(edit.path, edit.content);
        }
      }
      await this.project.writeConfig(root, options);
      if (options.icon) {
        await this.assets.generate(root, options.icon, present);
      }
    } catch (error) {
      this.log.warn("Writing the native identity failed, putting files back");
      for (const [path, content] of originals) {
        if (content === undefined) {
          await this.fs.rm(path, { force: true });
        } else {
          await this.fs.writeFile(path, content);
        }
      }
      throw error;
    }
  }

  protected async iosEdits(
    root: string,
    options: CapacitorOptions,
  ): Promise<Array<{ path: string; content: string }>> {
    if (await this.fs.exists(this.fs.join(root, "ios", "App", "Podfile"))) {
      throw new AlephaError(
        "ios/App/Podfile exists: the native identity writer supports the Swift Package Manager project Capacitor 8 creates, not CocoaPods. Recreate ios/ with alepha capacitor init.",
      );
    }

    const pbxproj = this.fs.join(
      root,
      "ios",
      "App",
      "App.xcodeproj",
      "project.pbxproj",
    );
    const plist = this.project.infoPlistPath(root);

    return [
      {
        path: pbxproj,
        content: this.setBundleId(
          await this.readOwned(pbxproj, "ios"),
          options.appId,
        ),
      },
      {
        path: plist,
        content: this.setIosUrlType(
          this.setDisplayName(
            await this.readOwned(plist, "ios"),
            options.appName,
          ),
          options.scheme,
          options.appId,
        ),
      },
    ];
  }

  protected async androidEdits(
    root: string,
    options: CapacitorOptions,
  ): Promise<Array<{ path: string; content: string }>> {
    const gradle = this.fs.join(root, "android", "app", "build.gradle");
    const strings = this.fs.join(
      root,
      "android",
      "app",
      "src",
      "main",
      "res",
      "values",
      "strings.xml",
    );
    const manifest = this.project.androidManifestPath(root);

    return [
      {
        path: gradle,
        content: this.setApplicationId(
          await this.readOwned(gradle, "android"),
          options.appId,
        ),
      },
      {
        path: strings,
        content: this.setStrings(await this.readOwned(strings, "android"), {
          app_name: options.appName,
          title_activity_main: options.appName,
          package_name: options.appId,
          custom_url_scheme: options.appId,
        }),
      },
      {
        path: manifest,
        content: this.setAndroidScheme(
          await this.readOwned(manifest, "android"),
          options.scheme,
        ),
      },
    ];
  }

  /**
   * Every `PRODUCT_BUNDLE_IDENTIFIER` of the project, which in the template
   * is the app target's Debug and Release, set to the app id. Several
   * different ids mean other targets (an extension, a widget): refused.
   */
  public setBundleId(pbxproj: string, appId: string): string {
    const pattern = /PRODUCT_BUNDLE_IDENTIFIER = ([^;]+);/g;
    const values = new Set([...pbxproj.matchAll(pattern)].map((it) => it[1]));
    if (values.size !== 1) {
      throw new AlephaError(
        `ios/App/App.xcodeproj/project.pbxproj has ${values.size === 0 ? "no" : "several different"} PRODUCT_BUNDLE_IDENTIFIER: the identity writer only handles the single app target cap add creates. Set the bundle id in Xcode instead.`,
      );
    }
    return pbxproj.replace(pattern, `PRODUCT_BUNDLE_IDENTIFIER = ${appId};`);
  }

  public setDisplayName(plist: string, appName: string): string {
    const pattern =
      /(<key>CFBundleDisplayName<\/key>\s*<string>)([^<]*)(<\/string>)/g;
    if ((plist.match(pattern) ?? []).length !== 1) {
      throw new AlephaError(
        "ios/App/App/Info.plist has no single CFBundleDisplayName string, as cap add writes it.",
      );
    }
    return plist.replace(
      pattern,
      (_all, open: string, _name: string, close: string) =>
        `${open}${this.escapeXml(appName)}${close}`,
    );
  }

  /**
   * The one URL type the plugin registers, with this scheme. Registered when
   * there is none; replaced when it is the plugin's single entry; refused
   * when the URL types are the user's.
   */
  public setIosUrlType(plist: string, scheme: string, appId: string): string {
    if (!plist.includes("<key>CFBundleURLTypes</key>")) {
      return this.schemes.registerIos(plist, scheme, appId) ?? plist;
    }
    const owned =
      /\t<key>CFBundleURLTypes<\/key>\s*<array>\s*<dict>\s*<key>CFBundleURLName<\/key>\s*<string>[^<]*<\/string>\s*<key>CFBundleURLSchemes<\/key>\s*<array>\s*<string>[^<]*<\/string>\s*<\/array>\s*<\/dict>\s*<\/array>/;
    if (!owned.test(plist)) {
      throw new AlephaError(
        "ios/App/App/Info.plist declares URL types of its own: the identity writer only replaces the single entry it registers. Keep one URL type, or manage the scheme in Xcode.",
      );
    }
    return plist.replace(owned, this.schemes.iosUrlTypes(scheme, appId));
  }

  public setApplicationId(gradle: string, appId: string): string {
    const pattern = /(applicationId\s+")([^"]*)(")/g;
    if ((gradle.match(pattern) ?? []).length !== 1) {
      throw new AlephaError(
        'android/app/build.gradle has no single applicationId "..." line, as cap add writes it (product flavors are not supported).',
      );
    }
    return gradle.replace(
      pattern,
      (_all, open: string, _id: string, close: string) =>
        `${open}${appId}${close}`,
    );
  }

  public setStrings(xml: string, values: Record<string, string>): string {
    let next = xml;
    for (const [name, value] of Object.entries(values)) {
      const pattern = new RegExp(
        `(<string name="${name}">)([^<]*)(</string>)`,
        "g",
      );
      if ((next.match(pattern) ?? []).length !== 1) {
        throw new AlephaError(
          `android/app/src/main/res/values/strings.xml has no single "${name}" string, as cap add writes it.`,
        );
      }
      next = next.replace(
        pattern,
        (_all, open: string, _old: string, close: string) =>
          `${open}${this.escapeAndroidString(value)}${close}`,
      );
    }
    return next;
  }

  /**
   * The one `VIEW`/`BROWSABLE` filter the plugin registers, with this
   * scheme: registered when absent, replaced when single, refused when
   * there are several.
   */
  public setAndroidScheme(manifest: string, scheme: string): string {
    const owned =
      /(<intent-filter>\s*<action android:name="android\.intent\.action\.VIEW" \/>\s*<category android:name="android\.intent\.category\.DEFAULT" \/>\s*<category android:name="android\.intent\.category\.BROWSABLE" \/>\s*<data android:scheme=")([^"]+)(" \/>\s*<\/intent-filter>)/g;
    const found = manifest.match(owned) ?? [];
    if (found.length === 0) {
      return this.schemes.registerAndroid(manifest, scheme) ?? manifest;
    }
    if (found.length > 1) {
      throw new AlephaError(
        "android/app/src/main/AndroidManifest.xml has several custom-scheme intent filters: the identity writer only replaces the single one it registers.",
      );
    }
    return manifest.replace(
      owned,
      (_all, open: string, _old: string, close: string) =>
        `${open}${scheme}${close}`,
    );
  }

  protected async readOwned(
    path: string,
    platform: CapacitorPlatform,
  ): Promise<string> {
    if (!(await this.fs.exists(path))) {
      throw new AlephaError(
        `${path} is missing: the ${platform}/ project does not have the layout cap add creates. Recreate it with alepha capacitor init.`,
      );
    }
    return this.fs.readTextFile(path);
  }

  protected escapeXml(value: string): string {
    return value
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  /**
   * Android string resources also give `'` and `"` a meaning.
   */
  protected escapeAndroidString(value: string): string {
    return this.escapeXml(value).replace(/'/g, "\\'").replace(/"/g, '\\"');
  }
}
