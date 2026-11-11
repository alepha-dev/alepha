import { MockOidcServer } from "alepha/testing/oidc";

/**
 * The identity provider the e2e signs in against: the mock from
 * `alepha/testing/oidc`, with the realm and client the Keycloak import in
 * `keycloak/acme-realm.json` declares, so the app runs unchanged against
 * either.
 */
const idp = await MockOidcServer.start({
  port: Number(process.env.IDP_PORT),
  realm: "acme",
  clients: [{ clientId: "acme-web" }],
  user: {
    sub: "ada",
    name: "Ada Lovelace",
    email: "ada@example.com",
    preferred_username: "ada",
  },
});

console.log(`mock identity provider at ${idp.issuer}`);
