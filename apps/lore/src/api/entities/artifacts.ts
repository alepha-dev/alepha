import { type Infer, z } from "alepha";
import { $entity, db } from "alepha/orm";
import { projects } from "./projects.ts";
import { users } from "./users.ts";

/**
 * Tags whose bytes may be replaced by a later push.
 *
 * A deliberately short list, and `latest` is on it because "latest" names a
 * moving target by definition. Everything else is write-once, and that is what
 * makes promote mean anything: deploying `1.2.3` to production is only "the
 * bytes staging tested" if the tag cannot be repointed in between.
 *
 * This is Docker's naming with ECR's tag immutability — not Docker Hub's
 * overwrite-anything default, which would make the guarantee unenforceable.
 */
export const MUTABLE_TAGS = ["latest"] as const;

/**
 * Whether a tag may be overwritten by a later push.
 *
 * Case-sensitive on purpose: `Latest` is a different tag, not a typo to be
 * quietly forgiven into mutability.
 */
export const isMutableTag = (tag: string): boolean =>
  (MUTABLE_TAGS as readonly string[]).includes(tag);

/**
 * One built artifact, identified by what it is rather than where it went.
 *
 * **Environment is deliberately absent.** The same tar.gz deploys to staging
 * and to production unchanged — Bay composes the domain and provisions the
 * database from its own configuration — so an artifact carrying an environment
 * would be claiming a property it does not have. Where it landed is a
 * `deployments` row, and one artifact can have many.
 *
 * **Content-addressed.** `sha256` is the identity of the bytes; `fileId` is
 * only where they happen to live today. An outpost already holding that digest
 * skips the download, which is what makes promoting to a second environment on
 * the same machine a symlink flip rather than a transfer.
 */
export const artifacts = $entity({
  name: "artifacts",
  schema: z.object({
    id: db.primaryKey(z.uuid()),
    projectId: db.ref(z.integer(), () => projects.cols.id, {
      onDelete: "cascade",
    }),
    /**
     * Matches `outpost_apps.app` and `deployments.app` — the join between an
     * artifact, the deploys that used it, and the machine running it.
     */
    app: z.string().min(1).max(100),
    /**
     * Docker-style tag, from `alepha pack --tag`. `latest` unless pinned.
     */
    tag: z.string().min(1).max(100),
    /** Digest of the tar.gz. Lowercase hex, always 64 characters. */
    sha256: z.string().length(64),
    /** The `alepha/api/files` row holding the bytes. */
    fileId: z.uuid(),
    sizeBytes: z.integer().min(0).optional(),
    createdBy: db.ref(z.uuid().optional(), () => users.cols.id),
    createdAt: db.createdAt(),
    updatedAt: db.updatedAt(),
  }),
  indexes: [
    { columns: ["projectId", "app", "tag"], unique: true },
    { columns: ["projectId", "sha256"] },
  ],
});

export type Artifact = Infer<typeof artifacts.schema>;
export type ArtifactInsert = Infer<typeof artifacts.insertSchema>;
