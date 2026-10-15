import { z } from "alepha";
import { HttpError } from "alepha/server";

/**
 * A dynamic client registration refused for its metadata (RFC 7591 section
 * 3.2.2): `reason` is the OAuth error code the response names.
 */
export const OAuthClientMetadataError = HttpError.extend({
  name: "OAUTH_CLIENT_METADATA",
  default: { status: 400 },
  schema: z.object({
    reason: z.enum(["invalid_redirect_uri", "invalid_client_metadata"]),
  }),
  message: "Invalid client metadata",
});

export type OAuthClientMetadataError = InstanceType<
  typeof OAuthClientMetadataError
>;
