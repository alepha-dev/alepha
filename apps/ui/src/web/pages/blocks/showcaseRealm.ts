import type { RealmConfig } from "alepha/api/users";

/**
 * A realm the auth screens can render against, with no realm behind it.
 *
 * `AuthLogin` and friends take their realm as a PROP rather than fetching it,
 * which is what lets the whole auth surface appear on a site with no users
 * table: the config decides which credential fields and which social buttons
 * exist, and nothing here has to authenticate anyone.
 *
 * Every provider is listed on purpose. A realm with one credential provider
 * renders a form and no divider, which is the least informative version of
 * this screen; three OAuth buttons is what shows the layout doing its job.
 */
export const SHOWCASE_REALM: RealmConfig = {
  realmName: "showcase",
  authenticationMethods: [
    { name: "credentials", type: "CREDENTIALS" },
    { name: "github", type: "OAUTH2" },
    { name: "google", type: "OAUTH2" },
    { name: "apple", type: "OAUTH2" },
  ],
  settings: {
    registrationAllowed: true,
  } as RealmConfig["settings"],
};
