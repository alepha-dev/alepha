/**
 * `mobile` | `tablet` | `desktop`, from a user-agent string.
 *
 * Three buckets and no more. A dimension's cardinality multiplies the number
 * of rows every other dimension has to be crossed with, and Analytics Engine
 * samples harder the more rows a window holds — so "iPhone 15 Pro" would cost
 * real precision everywhere else to answer a question nobody asks of a
 * documentation site. What is actually being asked here is whether the layout
 * needs to work on a small screen.
 *
 * Deliberately not a user-agent parsing library. Those carry a database of
 * thousands of patterns, need updating to stay accurate, and exist to answer
 * exactly the fine-grained question this is not asking. The tablet check runs
 * first because every Android tablet UA also contains `Mobile`'s siblings and
 * iPad's modern UA claims to be a Mac.
 *
 * An unrecognised or absent UA is `desktop`, not `unknown`: a fourth bucket
 * that only ever means "the regex missed" adds a row to every chart and tells
 * the reader nothing they can act on.
 */
export const sigilDeviceClass = (userAgent: string | undefined): string => {
  const ua = (userAgent ?? "").toLowerCase();
  if (!ua) return "desktop";
  // iPadOS 13+ reports itself as a Mac and is only distinguishable by having
  // a touch screen, which the server cannot see. `ipad` still appears on
  // older iOS and on the many clients that send a legacy UA.
  if (/ipad|tablet|playbook|silk|(android(?!.*mobile))/.test(ua)) {
    return "tablet";
  }
  if (/mobi|iphone|ipod|android|blackberry|iemobile|opera mini/.test(ua)) {
    return "mobile";
  }
  return "desktop";
};
