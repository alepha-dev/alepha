import { Alepha } from "alepha";
import { describe, it } from "vitest";

import { NativeSchemes } from "../services/NativeSchemes.ts";
import { capacitorTemplates } from "./fixtures.ts";

describe("NativeSchemes", () => {
  const schemes = () => Alepha.create().inject(NativeSchemes);

  describe("iOS", () => {
    it("declares the scheme in Info.plist as CFBundleURLTypes", ({
      expect,
    }) => {
      const plist = schemes().registerIos(
        capacitorTemplates.infoPlist,
        "mobile",
        "dev.alepha.mobile",
      );

      expect(plist).toContain("<key>CFBundleURLTypes</key>");
      expect(plist).toContain("<string>mobile</string>");
      expect(plist).toContain("<string>dev.alepha.mobile</string>");
      // Everything that was there stays, in place.
      expect(plist).toContain(
        "\t<key>UIViewControllerBasedStatusBarAppearance</key>\n\t<true/>\n\t<key>CFBundleURLTypes</key>",
      );
      expect(plist?.endsWith("</dict>\n</plist>\n")).toBe(true);
    });

    it("answers null when the scheme is already there", ({ expect }) => {
      const once = schemes().registerIos(
        capacitorTemplates.infoPlist,
        "mobile",
        "dev.alepha.mobile",
      ) as string;

      expect(schemes().registerIos(once, "mobile", "dev.alepha.mobile")).toBe(
        null,
      );
    });

    it("refuses URL types of the user's own, with the lines to add", ({
      expect,
    }) => {
      const once = schemes().registerIos(
        capacitorTemplates.infoPlist,
        "other",
        "dev.alepha.other",
      ) as string;

      expect(() =>
        schemes().registerIos(once, "mobile", "dev.alepha.mobile"),
      ).toThrow(/<string>mobile<\/string>/);
    });
  });

  describe("Android", () => {
    it("adds a VIEW intent filter after the launcher filter", ({ expect }) => {
      const manifest = schemes().registerAndroid(
        capacitorTemplates.androidManifest,
        "mobile",
      ) as string;

      expect(manifest).toContain('<data android:scheme="mobile" />');
      expect(
        manifest.indexOf("android.intent.category.LAUNCHER") <
          manifest.indexOf('android:scheme="mobile"'),
      ).toBe(true);
      expect(manifest.indexOf('android:scheme="mobile"')).toBeLessThan(
        manifest.indexOf("</activity>"),
      );
    });

    it("answers null when the scheme is already there", ({ expect }) => {
      const once = schemes().registerAndroid(
        capacitorTemplates.androidManifest,
        "mobile",
      ) as string;

      expect(schemes().registerAndroid(once, "mobile")).toBe(null);
    });

    it("refuses a manifest without the one launcher activity", ({ expect }) => {
      expect(() =>
        schemes().registerAndroid("<manifest></manifest>", "mobile"),
      ).toThrow(/android:scheme="mobile"/);
    });
  });
});
