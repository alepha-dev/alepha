import type { AppInstanceResource } from "@/api/schemas/appInstanceResourceSchema.ts";

/**
 * Where an app lives, as a link, or `undefined` when nobody knows yet.
 *
 * Two sources, one answer, and since Apps v3 they sit on two rows. `url` is
 * what an operator pinned, on the instance; `lastSeenHost` is where the app
 * itself reported from, on the sigil that instance holds. An instance with no
 * sigil has no detected half at all, which is a normal state rather than a
 * missing one: nothing has reported yet.
 *
 * The pin wins, and silently: the whole point of typing one is to override a
 * detected address that is right about the host and wrong about the app - an
 * apex that redirects to `www`, a preview deployment sharing a sigil with
 * production, an app reached through a path nobody would guess.
 *
 * `https://` in front of a bare host rather than a guess at the scheme. The
 * `Host` header carries none, so the alternative is asking for
 * `x-forwarded-proto` - a header a proxy may not set, to distinguish a case
 * (a production app served over plain HTTP) that would be a finding of its own.
 * An operator whose app is genuinely `http://` pins the URL.
 */
export const appUrl = (instance: AppInstanceResource): string | undefined => {
  if (instance.url) {
    return instance.url;
  }
  const host = instance.sigil?.lastSeenHost;
  return host ? `https://${host}` : undefined;
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
