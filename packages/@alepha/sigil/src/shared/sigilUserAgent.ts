/**
 * A user agent reduced to the browser family, its major version and the OS.
 *
 * The feedback widget used to carry `navigator.userAgent` whole. A modern UA
 * string is a few hundred characters of build numbers, engine versions, device
 * models and locale hints - one of the highest-entropy identifiers a browser
 * hands out, and near enough a fingerprint on its own. It travelled through a
 * popup query string onto a third-party form, was persisted verbatim, and was
 * then readable by every member of the receiving project.
 *
 * What a bug report actually needs from it is which browser and which
 * operating system, which is three tokens. The major version stays: browsers
 * auto-update, so almost everyone is on the same one and it adds little to
 * tell people apart, while "Safari 17" against "Safari 26" is frequently the
 * whole bug.
 *
 * Deliberately not a user-agent parsing library, for the reason given on
 * {@link sigilDeviceClass}: those carry thousands of patterns and exist to
 * answer the fine-grained question this is not asking.
 *
 * An empty or absent UA returns `""`, so the caller omits the field entirely.
 * A UA that matches nothing returns `"Unknown"` - which is a different fact
 * from "no UA was sent", and worth being able to tell apart on a single
 * report even though it would be noise as a chart dimension.
 */
export const sigilUserAgent = (userAgent: string | undefined): string => {
  const ua = (userAgent ?? "").trim();
  if (!ua) return "";

  // Order matters: every entry below also claims to be the ones after it.
  // Edge says Chrome, Chrome says Safari, and all of them say Mozilla.
  const families: Array<[string, RegExp]> = [
    ["Edge", /\bEdgi?A?\/(\d+)/],
    ["Opera", /\bOPR\/(\d+)/],
    ["Samsung Internet", /\bSamsungBrowser\/(\d+)/],
    ["Firefox", /\b(?:Firefox|FxiOS)\/(\d+)/],
    ["Chrome", /\b(?:Chrome|CriOS)\/(\d+)/],
    // Safari puts its own version in `Version/`, not in the `Safari/` token,
    // which carries the WebKit build instead.
    ["Safari", /\bVersion\/(\d+)[\d.]*\s+(?:Mobile\/\S+\s+)?Safari\//],
  ];

  // Android before Linux and ChromeOS before Linux, because both say Linux.
  // iPadOS 13+ reports itself as a Mac and lands on macOS - the same blind
  // spot {@link sigilDeviceClass} documents, and for the same reason: only a
  // touch-capability check tells them apart, and there is no UA token for it.
  const systems: Array<[string, RegExp]> = [
    ["Android", /\bAndroid\b/],
    ["iOS", /\b(?:iPhone|iPad|iPod)\b/],
    ["Windows", /\bWindows NT\b/],
    ["ChromeOS", /\bCrOS\b/],
    ["macOS", /\bMac OS X\b|\bMacintosh\b/],
    ["Linux", /\bLinux\b/],
  ];

  let browser = "";
  for (const [name, pattern] of families) {
    const match = pattern.exec(ua);
    if (match) {
      browser = match[1] ? `${name} ${match[1]}` : name;
      break;
    }
  }

  let system = "";
  for (const [name, pattern] of systems) {
    if (pattern.test(ua)) {
      system = name;
      break;
    }
  }

  if (browser && system) return `${browser} on ${system}`;
  return browser || system || "Unknown";
};
