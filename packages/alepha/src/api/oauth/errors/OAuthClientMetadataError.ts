import { AlephaError } from "alepha";

/**
 * A client registration refused for what it asked for, never for how the
 * server fared.
 *
 * `code` is the RFC 7591 §3.2.2 error the registration endpoint answers with,
 * under a 400: `invalid_redirect_uri` for a redirect URI the server will not
 * send a code to, `invalid_client_metadata` for every other refusal.
 *
 * ⚠️ A plain `AlephaError` escaped the DCR route as a 500, so a client's typo
 * became a server error and a blight on the app that received it.
 */
export class OAuthClientMetadataError extends AlephaError {
  public readonly status = 400;
  public readonly code: "invalid_redirect_uri" | "invalid_client_metadata";

  constructor(
    code: "invalid_redirect_uri" | "invalid_client_metadata",
    message: string,
  ) {
    super(message);
    this.code = code;
  }
}
