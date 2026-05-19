import { t } from "alepha";

/**
 * RFC 7591 Dynamic Client Registration request body.
 * Only the fields Alepha consumes are typed; unknown fields are ignored.
 */
export const registerClientBodySchema = t.object(
  {
    client_name: t.optional(t.text({ maxLength: 200 })),
    redirect_uris: t.array(t.text({ maxLength: 2048 }), { minItems: 1 }),
    scope: t.optional(t.text({ maxLength: 1024 })),
    grant_types: t.optional(t.array(t.text())),
    token_endpoint_auth_method: t.optional(t.text()),
  },
  { additionalProperties: true },
);
