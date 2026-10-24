import { $ownsProject } from "@lore/core/api";
import { $inject, z } from "alepha";
import { $action, okSchema } from "alepha/server";

import type { RegistryCredentialRow } from "../entities/registryCredentials.ts";
import { registryCredentialResourceSchema } from "../schemas/registryCredentialResourceSchema.ts";
import { RegistryCredentialService } from "../services/RegistryCredentialService.ts";

/**
 * A project's container registry credentials (#Q2693).
 *
 * ⚠️ No response carries a secret, for anybody, on the way in or out. Reads
 * take `app:read` (a member sees which registries the project pulls from);
 * writes take `deploy:manage` behind `apps.deploy`, because a credential is
 * part of what a deploy ships to an estate.
 */
export class RegistryCredentialController {
  protected readonly credentials = $inject(RegistryCredentialService);

  protected writeGate = () =>
    $ownsProject({
      param: "projectId",
      requires: "deploy:manage",
      capability: { key: "apps", option: "deploy" },
    });

  protected readGate = () =>
    $ownsProject({ param: "projectId", requires: "app:read" });

  listRegistryCredentials = $action({
    use: [this.readGate()],
    method: "GET",
    path: "/projects/:projectId/registries",
    description:
      "The registries this project holds a credential for. Hosts and usernames, never a secret.",
    schema: {
      params: z.object({ projectId: z.integer() }),
      response: z.object({ items: z.array(registryCredentialResourceSchema) }),
    },
    handler: async ({ params }) => ({
      items: (await this.credentials.list(params.projectId)).map((row) =>
        this.resource(row),
      ),
    }),
  });

  setRegistryCredential = $action({
    use: [this.writeGate()],
    method: "PUT",
    path: "/projects/:projectId/registries",
    description:
      "Store the credential for one registry host, replacing any there. The secret is sealed and never read back.",
    schema: {
      params: z.object({ projectId: z.integer() }),
      body: z.object({
        host: z.string().min(1).max(253),
        username: z.string().min(1).max(200),
        /**
         * ⚠️ The one place the secret is on the wire, one way.
         */
        secret: z.string().min(1).max(10_000),
      }),
      response: registryCredentialResourceSchema,
    },
    handler: async ({ params, body, user }) =>
      this.resource(
        await this.credentials.set({
          projectId: params.projectId,
          host: body.host,
          username: body.username,
          secret: body.secret,
          updatedBy: user?.id,
        }),
      ),
  });

  removeRegistryCredential = $action({
    use: [this.writeGate()],
    method: "DELETE",
    path: "/projects/:projectId/registries",
    description: "Forget the credential for one registry host.",
    schema: {
      params: z.object({ projectId: z.integer() }),
      query: z.object({ host: z.string().min(1).max(253) }),
      response: okSchema,
    },
    handler: async ({ params, query }) => {
      await this.credentials.remove(params.projectId, query.host);
      return { ok: true };
    },
  });

  protected resource(row: RegistryCredentialRow) {
    return {
      id: row.id,
      host: row.host,
      username: row.username,
      updatedAt: row.updatedAt,
      updatedBy: row.updatedBy,
    };
  }
}
