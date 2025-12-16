export interface UserAgentInfo {
  os:
    | "Windows"
    | "Android"
    | "Ubuntu"
    | "MacOS"
    | "iOS"
    | "Linux"
    | "FreeBSD"
    | "OpenBSD"
    | "ChromeOS"
    | "BlackBerry"
    | "Symbian"
    | "Windows Phone";
  browser:
    | "Chrome"
    | "Firefox"
    | "Safari"
    | "Edge"
    | "Opera"
    | "Internet Explorer"
    | "Brave"
    | "Vivaldi"
    | "Samsung Browser"
    | "UC Browser"
    | "Yandex";
  device: "MOBILE" | "DESKTOP" | "TABLET";
}

/**
 * Simple User-Agent parser to detect OS, browser, and device type.
 * This parser is not exhaustive and may not cover all edge cases.
 *
 * Use result for non
 */
export class UserAgentParser {
  public parse(userAgent: string = ""): UserAgentInfo {
    const ua = userAgent.toLowerCase();

    // Default values
    let os: UserAgentInfo["os"] = "Windows";
    let browser: UserAgentInfo["browser"] = "Chrome";
    let device: UserAgentInfo["device"] = "DESKTOP";

    // Detect OS - Order matters for specificity
    if (ua.includes("windows phone")) {
      os = "Windows Phone";
    } else if (ua.includes("windows")) {
      os = "Windows";
    } else if (ua.includes("android")) {
      os = "Android";
    } else if (
      ua.includes("iphone") ||
      ua.includes("ipad") ||
      ua.includes("ipod") ||
      (ua.includes("ios") && !ua.includes("android"))
    ) {
      os = "iOS";
    } else if (
      ua.includes("mac os") ||
      ua.includes("macos") ||
      ua.includes("macintosh")
    ) {
      os = "MacOS";
    } else if (ua.includes("cros") || ua.includes("chromeos")) {
      os = "ChromeOS";
    } else if (ua.includes("ubuntu")) {
      os = "Ubuntu";
    } else if (ua.includes("freebsd")) {
      os = "FreeBSD";
    } else if (ua.includes("openbsd")) {
      os = "OpenBSD";
    } else if (ua.includes("blackberry") || ua.includes("bb10")) {
      os = "BlackBerry";
    } else if (ua.includes("symbian") || ua.includes("symbos")) {
      os = "Symbian";
    } else if (ua.includes("linux") || ua.includes("x11")) {
      os = "Linux";
    }

    // Detect Browser/browser - Order matters, check most specific first
    if (ua.includes("yabrowser") || ua.includes("yandex")) {
      browser = "Yandex";
    } else if (ua.includes("brave")) {
      browser = "Brave";
    } else if (ua.includes("vivaldi")) {
      browser = "Vivaldi";
    } else if (ua.includes("samsungbrowser") || ua.includes("samsung")) {
      browser = "Samsung Browser";
    } else if (ua.includes("ucbrowser") || ua.includes("uc browser")) {
      browser = "UC Browser";
    } else if (
      ua.includes("opera") ||
      ua.includes("opr/") ||
      ua.includes("opios")
    ) {
      browser = "Opera";
    } else if (
      ua.includes("edg/") ||
      ua.includes("edge") ||
      ua.includes("edgios")
    ) {
      browser = "Edge";
    } else if (ua.includes("firefox") && !ua.includes("seamonkey")) {
      browser = "Firefox";
    } else if (ua.includes("trident") || ua.includes("msie")) {
      browser = "Internet Explorer";
    } else if (
      ua.includes("safari") &&
      !ua.includes("chrome") &&
      !ua.includes("chromium")
    ) {
      browser = "Safari";
    } else if (
      ua.includes("chrome") ||
      ua.includes("chromium") ||
      ua.includes("crios")
    ) {
      browser = "Chrome";
    }

    // Detect Device Type
    const mobileKeywords = [
      "mobile",
      "android",
      "iphone",
      "ipod",
      "blackberry",
      "windows phone",
      "opera mini",
      "iemobile",
      "mobile safari",
      "nokia",
      "symbian",
    ];

    const tabletKeywords = [
      "ipad",
      "tablet",
      "kindle",
      "silk",
      "gt-p",
      "sm-t",
      "nexus 7",
      "nexus 10",
    ];

    const isTablet = tabletKeywords.some((keyword) => ua.includes(keyword));
    const isMobile = mobileKeywords.some((keyword) => ua.includes(keyword));

    if (isTablet) {
      device = "TABLET";
    } else if (isMobile) {
      device = "MOBILE";
    } else {
      device = "DESKTOP";
    }

    return { os, browser, device };
  }
}
