import { type Infer, z } from "alepha";

export const authenticationProviderSchema = z
  .object({
    name: z.text({
      description: "Name of the authentication provider.",
    }),
    type: z
      .enum(["OAUTH2", "OIDC", "CREDENTIALS"])
      .describe("Type of the authentication provider."),
  })
  .meta({ title: "AuthenticationProvider" });

export type AuthenticationProvider = Infer<typeof authenticationProviderSchema>;
