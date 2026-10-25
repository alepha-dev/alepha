import { projects } from "@lore/core/schemas";
import { type Infer, z } from "alepha";
import { $entity, db } from "alepha/orm";

/**
 * A project's credential for one container registry: GitLab, Harbor, Nexus,
 * a self-hosted `registry:2`, where a company's images live.
 *
 * ## ⚠️ Sealed, write-only, and never read back
 *
 * {@link secretSealed} is a `CredentialSealService` ciphertext under
 * `REGISTRY_PURPOSE`. No response carries it, nor any prefix of it: a
 * registry token is not a variable anybody needs to recognise on screen. It
 * is opened for two things only, both server-side: verifying an image
 * reference at push, and the deploy of THIS project's stack to its estate.
 *
 * Per project, never per user or per estate: an estate is lent to many
 * projects, and one project's company registry is not another's.
 */
export const registryCredentials = $entity({
  name: "registry_credentials",
  schema: z.object({
    id: db.primaryKey(z.uuid()),
    createdAt: db.createdAt(),
    updatedAt: db.updatedAt(),
    projectId: db.ref(z.integer(), () => projects.cols.id, {
      onDelete: "cascade",
    }),
    /**
     * The registry host, lowercased, with its port when it has one
     * (`registry.corp.example:5000`).
     */
    host: z.string().min(1).max(253),
    username: z.string().min(1).max(200),
    secretSealed: z.string().min(1).max(20_000),
    keyVersion: db.default(z.integer(), 1),
    updatedBy: z.uuid().optional(),
  }),
  indexes: [{ columns: ["projectId", "host"], unique: true }],
});

export type RegistryCredentialRow = Infer<typeof registryCredentials.schema>;
