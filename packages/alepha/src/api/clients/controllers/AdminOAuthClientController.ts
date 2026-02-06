import { $inject, t } from "alepha";
import { $action, okSchema } from "alepha/server";
import { adminClientQuerySchema } from "../schemas/adminClientQuerySchema.ts";
import { adminClientResourceSchema } from "../schemas/adminClientResourceSchema.ts";
import { createClientBodySchema } from "../schemas/createClientBodySchema.ts";
import { createClientResponseSchema } from "../schemas/createClientResponseSchema.ts";
import { OAuth2Service } from "../services/OAuth2Service.ts";

/**
 * Admin REST API controller for OAuth2 client management.
 */
export class AdminOAuthClientController {
  protected readonly url = "/admin/oauth-clients";
  protected readonly group = "admin:oauth-clients";
  protected readonly oauth2Service = $inject(OAuth2Service);

  /**
   * List OAuth2 clients with pagination and filtering.
   */
  public readonly findClients = $action({
    path: this.url,
    group: this.group,
    secure: true,
    description: "Find OAuth2 clients with pagination and filtering",
    schema: {
      query: adminClientQuerySchema,
      response: t.page(adminClientResourceSchema),
    },
    handler: ({ query }) => {
      const { enabled, firstParty, ...pagination } = query;
      return this.oauth2Service.findClients({
        enabled,
        firstParty,
        ...pagination,
      });
    },
  });

  /**
   * Create a new OAuth2 client.
   */
  public readonly createClient = $action({
    method: "POST",
    path: this.url,
    group: this.group,
    secure: true,
    description: "Create a new OAuth2 client",
    schema: {
      body: createClientBodySchema,
      response: createClientResponseSchema,
    },
    handler: async ({ body }) => {
      const { client, clientSecret } = await this.oauth2Service.createClient({
        name: body.name,
        description: body.description,
        logoUri: body.logoUri,
        clientUri: body.clientUri,
        redirectUris: body.redirectUris,
        grantTypes: body.grantTypes,
        scopes: body.scopes,
        tokenEndpointAuthMethod: body.tokenEndpointAuthMethod,
        firstParty: body.firstParty,
      });

      return {
        id: client.id,
        clientId: client.clientId,
        clientSecret,
        name: client.name,
        redirectUris: client.redirectUris,
        grantTypes: client.grantTypes,
        scopes: client.scopes,
        tokenEndpointAuthMethod: client.tokenEndpointAuthMethod,
        firstParty: client.firstParty,
        createdAt: client.createdAt,
      };
    },
  });

  /**
   * Get an OAuth2 client by ID.
   */
  public readonly getClient = $action({
    path: `${this.url}/:id`,
    group: this.group,
    secure: true,
    description: "Get an OAuth2 client by ID",
    schema: {
      params: t.object({
        id: t.uuid(),
      }),
      response: adminClientResourceSchema,
    },
    handler: ({ params }) => this.oauth2Service.getClientById(params.id),
  });

  /**
   * Disable an OAuth2 client.
   */
  public readonly disableClient = $action({
    method: "DELETE",
    path: `${this.url}/:id`,
    group: this.group,
    secure: true,
    description: "Disable an OAuth2 client",
    schema: {
      params: t.object({
        id: t.uuid(),
      }),
      response: okSchema,
    },
    handler: async ({ params }) => {
      await this.oauth2Service.disableClient(params.id);
      return { ok: true, id: params.id };
    },
  });
}
