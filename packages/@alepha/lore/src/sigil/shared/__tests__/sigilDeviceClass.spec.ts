import { describe, expect, it } from "vitest";

import { sigilDeviceClass } from "../sigilDeviceClass.ts";

const IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
const ANDROID_PHONE =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36";
const ANDROID_TABLET =
  "Mozilla/5.0 (Linux; Android 13; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const IPAD_LEGACY =
  "Mozilla/5.0 (iPad; CPU OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1";
const MAC =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

describe("sigilDeviceClass", () => {
  it("classifies phones as mobile", () => {
    expect(sigilDeviceClass(IPHONE)).toBe("mobile");
    expect(sigilDeviceClass(ANDROID_PHONE)).toBe("mobile");
  });

  it("classifies an Android tablet as tablet, not mobile", () => {
    // The distinguishing feature is the ABSENCE of `Mobile`, which is why the
    // tablet branch has to run first and has to be a negative lookahead.
    expect(sigilDeviceClass(ANDROID_TABLET)).toBe("tablet");
  });

  it("classifies an iPad that still says iPad as tablet", () => {
    expect(sigilDeviceClass(IPAD_LEGACY)).toBe("tablet");
  });

  it("classifies a desktop browser as desktop", () => {
    expect(sigilDeviceClass(MAC)).toBe("desktop");
  });

  it("falls back to desktop rather than minting an `unknown` bucket", () => {
    // A fourth value that only ever means "the regex missed" would add a row
    // to every device chart and tell the reader nothing actionable.
    expect(sigilDeviceClass(undefined)).toBe("desktop");
    expect(sigilDeviceClass("")).toBe("desktop");
    expect(sigilDeviceClass("curl/8.4.0")).toBe("desktop");
  });

  it("is case-insensitive", () => {
    expect(sigilDeviceClass("SOMETHING IPHONE SOMETHING")).toBe("mobile");
  });
});
