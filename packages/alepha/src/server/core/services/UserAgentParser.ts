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
    | "Windows Phone"
    | "Unknown";
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
    | "Yandex"
    | "Unknown";
  device: "MOBILE" | "DESKTOP" | "TABLET" | "UNKNOWN";
}

/**
 * Simple User-Agent parser to detect OS, browser, and device type.
 * This parser is not exhaustive and may not cover all edge cases: use the
 * result for coarse analytics (OS, browser family, device type), never for
 * a security decision.
 */
export class UserAgentParser {
  public parse(userAgent: string = ""): UserAgentInfo {
    const ua = userAgent.toLowerCase();

    // Nothing is assumed. A request carrying no `user-agent` at all, or one
    // that no branch below recognises (an API client, an MCP agent, curl),
    // is reported as unknown rather than attributed to the commonest
    // browser. These defaults used to be "Windows" and "Chrome", so every
    // header-less client was stored as a Windows desktop running Chrome and
    // listed as such on the account sessions page: a claim the request never
    // made, and one a user cannot tell apart from a real sign-in.
    let os: UserAgentInfo["os"] = "Unknown";
    let browser: UserAgentInfo["browser"] = "Unknown";

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
    } else if (ua.includes("samsungbrowser")) {
      // NOT a bare "samsung" match: Samsung puts the model in the UA of
      // every browser on the device, so "SAMSUNG SM-S918B" running ordinary
      // Chrome used to be filed as Samsung Internet.
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
      // Edge names itself per platform: `Edg/` on desktop, `EdgA/` on
      // Android, `EdgiOS/` on iOS. Only the desktop and legacy spellings
      // were matched, so Edge on Android was reported as Chrome.
      ua.includes("edga/") ||
      ua.includes("edgios") ||
      ua.includes("edge")
    ) {
      browser = "Edge";
    } else if (
      (ua.includes("firefox") || ua.includes("fxios")) &&
      !ua.includes("seamonkey")
    ) {
      browser = "Firefox";
    } else if (ua.includes("trident") || ua.includes("msie")) {
      browser = "Internet Explorer";
    } else if (
      ua.includes("chrome") ||
      ua.includes("chromium") ||
      ua.includes("crios")
    ) {
      browser = "Chrome";
    } else if (ua.includes("safari")) {
      // Safari is the LAST branch, and deliberately unguarded. Every engine
      // on iOS is WebKit and each one appends "Safari/60x" to its UA, so a
      // test for "safari and not chrome" matched Chrome for iOS (`CriOS`)
      // and Firefox for iOS (`FxiOS`) and reported both as Safari. Reaching
      // this branch now means no other engine claimed the string, which is
      // the only thing "Safari" can honestly mean here.
      browser = "Safari";
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

    // Android's own convention, and the only reliable phone/tablet signal it
    // gives: a phone build carries the "Mobile" token and a tablet build
    // omits it. Without this rule every Android tablet matched the "android"
    // mobile keyword and was filed as a phone, and no keyword list fixes
    // that by enumerating tablet model numbers.
    const isAndroidTablet = ua.includes("android") && !ua.includes("mobile");

    // DESKTOP stays an inference, not a fallback: it is what a recognised
    // user agent naming neither a phone nor a tablet must be. When nothing
    // at all was recognised there is no desktop to infer, only an unknown
    // client, so the absence is reported instead of guessed.
    let device: UserAgentInfo["device"];
    if (isTablet || isAndroidTablet) {
      device = "TABLET";
    } else if (isMobile) {
      device = "MOBILE";
    } else if (os !== "Unknown" || browser !== "Unknown") {
      device = "DESKTOP";
    } else {
      device = "UNKNOWN";
    }

    return { os, browser, device };
  }
}
