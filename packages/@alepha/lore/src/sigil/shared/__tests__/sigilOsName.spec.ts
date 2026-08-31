import { describe, it } from "vitest";

import { sigilOsName } from "../sigilOsName.ts";

const WINDOWS = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/131.0.0.0";
const MACOS =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17.6 Safari/605.1.15";
const IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_6 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1";
const IPAD =
  "Mozilla/5.0 (iPad; CPU OS 17_6 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1";
const ANDROID =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/131.0.0.0 Mobile Safari/537.36";
const LINUX =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36";
const CHROMEOS =
  "Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36";

describe("sigilOsName", () => {
  it("names the five it knows", ({ expect }) => {
    expect(sigilOsName(WINDOWS)).toBe("windows");
    expect(sigilOsName(MACOS)).toBe("macos");
    expect(sigilOsName(IPHONE)).toBe("ios");
    expect(sigilOsName(ANDROID)).toBe("android");
    expect(sigilOsName(LINUX)).toBe("linux");
  });

  /**
   * The two nestings the order exists for. Every Android UA carries `Linux`,
   * and every iOS UA claims to be `like Mac OS X`.
   */
  it("does not let a nested claim win", ({ expect }) => {
    expect(sigilOsName(ANDROID)).not.toBe("linux");
    expect(sigilOsName(IPHONE)).not.toBe("macos");
  });

  it("files ChromeOS as linux rather than inventing a bucket", ({ expect }) => {
    expect(sigilOsName(CHROMEOS)).toBe("linux");
  });

  /**
   * ⚠️ A modern iPad reports itself as a Mac and is only distinguishable by
   * having a touch screen, which a server cannot see. Pinned as a KNOWN
   * disagreement with `sigilDeviceClass`, which files the same device as a
   * tablet on other evidence: both are as honest as their inputs allow, and
   * inventing an `ipados` bucket the UA does not support would be worse.
   */
  it("files a legacy iPad as ios and a modern one as macos", ({ expect }) => {
    expect(sigilOsName(IPAD)).toBe("ios");
    // What iPadOS 13+ actually sends: byte-identical to a desktop Mac.
    expect(sigilOsName(MACOS)).toBe("macos");
  });

  it("answers other for an absent or unrecognised agent", ({ expect }) => {
    expect(sigilOsName(undefined)).toBe("other");
    expect(sigilOsName("")).toBe("other");
    expect(sigilOsName("curl/8.7.1")).toBe("other");
  });
});
