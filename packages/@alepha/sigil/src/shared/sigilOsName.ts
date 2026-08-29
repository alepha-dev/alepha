/**
 * `windows` | `macos` | `ios` | `android` | `linux` | `other`, from a
 * user-agent string.
 *
 * Six buckets and no more, for the reason {@link sigilDeviceClass} has three
 * and {@link sigilBrowserName} has five. Version numbers are not here on
 * purpose: they multiply the rows every other dimension is crossed with, and
 * Analytics Engine samples harder the more rows a window holds.
 *
 * **Order is the whole implementation**, for the same reason it is next door:
 * these strings nest.
 *
 * - Android sends `Linux` too, so it has to be tested first or every Android
 *   visit is filed as Linux.
 * - iOS sends `like Mac OS X`, so it has to be tested before macOS.
 * - `Windows Phone` is Windows for this purpose; the device split is
 *   {@link sigilDeviceClass}'s question, not this one's.
 *
 * ⚠️ **iPadOS 13+ reports itself as a Mac** and is only distinguishable by
 * having a touch screen, which a server cannot see. So a modern iPad lands in
 * `macos` here while `sigilDeviceClass` files it as a tablet on other
 * evidence. The two dimensions disagree about that device and both are being
 * as honest as their inputs allow; inventing an `ipados` bucket the UA does
 * not support would be the same invented precision this epic keeps deleting.
 *
 * An unrecognised or absent UA is `other`, and ambiguity resolves there:
 * naming an OS wrongly is worse than not naming it.
 */
export const sigilOsName = (userAgent: string | undefined): string => {
  const ua = (userAgent ?? "").toLowerCase();
  if (!ua) return "other";

  // Before Linux, which every Android UA also carries.
  if (/android/.test(ua)) return "android";
  // Before macOS, which every iOS UA claims to be like.
  if (/iphone|ipad|ipod|ios/.test(ua)) return "ios";
  if (/windows/.test(ua)) return "windows";
  if (/mac os x|macintosh/.test(ua)) return "macos";
  if (/linux|x11|cros/.test(ua)) return "linux";

  return "other";
};
