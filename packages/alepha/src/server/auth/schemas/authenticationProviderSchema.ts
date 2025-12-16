import { type Static, t } from "alepha";

export const authenticationProviderSchema = t.object(
  {
    name: t.text({
      description: "Name of the authentication provider.",
    }),
    type: t.enum(["OAUTH2", "OIDC", "CREDENTIALS"], {
      description: "Type of the authentication provider.",
    }),
  },
  {
    title: "AuthenticationProvider",
  },
);

export type AuthenticationProvider = Static<
  typeof authenticationProviderSchema
>;
