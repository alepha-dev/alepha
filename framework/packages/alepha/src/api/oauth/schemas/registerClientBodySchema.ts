import { z } from "alepha";

/**
 * RFC 7591 Dynamic Client Registration request body.
 * Only the fields Alepha consumes are typed; unknown fields are ignored.
 */
export const registerClientBodySchema = z
  .object({
    client_name: z.text({ maxLength: 200 }).optional(),
    redirect_uris: z.array(z.text({ maxLength: 2048 })).min(1),
    scope: z.text({ maxLength: 1024 }).optional(),
    grant_types: z.array(z.text()).optional(),
    token_endpoint_auth_method: z.text().optional(),
  })
  .meta({ additionalProperties: true });
