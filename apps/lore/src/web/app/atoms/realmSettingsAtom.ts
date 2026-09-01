import { $atom, z } from "alepha";

/**
 * The one realm setting the signed-out chrome has to know about.
 *
 * Set by the `home` route loader for an anonymous visitor, so the landing
 * page's primary call to action is right in the FIRST paint rather than
 * changing under the cursor once a client fetch lands. Nothing sets it for a
 * signed-in visitor: they see the dashboard, which has no signup CTA to get
 * wrong.
 *
 * The gate itself is server-side and always has been: `RegistrationService`
 * refuses, and `@alepha/ui`'s register page renders its own closed alert.
 * This is presentation, and it exists because a stranger walked into that
 * alert by clicking the only button on the page.
 *
 * Defaults to open. A realm config that could not be read leaves the CTA
 * exactly as it has always been, which costs a stranger one dead-end page and
 * costs a legitimate visitor nothing.
 */
export const realmSettingsAtom = $atom({
  name: "lor.realm.settings",
  schema: z.object({
    registrationAllowed: z.boolean(),
  }),
  default: { registrationAllowed: true },
});
