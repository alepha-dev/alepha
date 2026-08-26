import type { SigilResource } from "@/api/schemas/sigilResourceSchema.ts";

/**
 * Where an app lives, as a link, or `undefined` when nobody knows yet.
 *
 * Two sources, one answer. `url` is what an operator pinned; `lastSeenHost` is
 * where the app itself last reported from. The pin wins, and silently: the
 * whole point of typing one is to override a detected address that is right
 * about the host and wrong about the app - an apex that redirects to `www`, a
 * preview deployment sharing a sigil with production, an app reached through a
 * path nobody would guess.
 *
 * `https://` in front of a bare host rather than a guess at the scheme. The
 * `Host` header carries none, so the alternative is asking for
 * `x-forwarded-proto` - a header a proxy may not set, to distinguish a case
 * (a production app served over plain HTTP) that would be a finding of its own.
 * An operator whose app is genuinely `http://` pins the URL.
 */
export const appUrl = (sigil: SigilResource): string | undefined => {
  if (sigil.url) {
    return sigil.url;
  }
  return sigil.lastSeenHost ? `https://${sigil.lastSeenHost}` : undefined;
};

/**
 * The same address without its scheme, which is what a link should read as.
 *
 * A URL bar is not a label: `https://` is noise in every one of them, and a
 * trailing slash is noise in all but the ones that carry a path. What is left
 * is the part that identifies the app.
 */
export const appUrlLabel = (url: string): string =>
  url.replace(/^https?:\/\//, "").replace(/\/$/, "");
