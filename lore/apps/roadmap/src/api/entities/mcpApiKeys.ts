import { type Static, t } from "alepha";
import { users } from "alepha/api/users";
import { $entity, pg } from "alepha/orm";
import { projects } from "./projects.ts";

export const mcpApiKeys = $entity({
  name: "mcp_api_keys",
  schema: t.object({
    id: pg.primaryKey(t.uuid()),
    createdAt: pg.createdAt(),
    updatedAt: pg.updatedAt(),
    userId: pg.ref(t.uuid(), () => users.cols.id, {
      onDelete: "cascade",
    }),
    projectId: pg.ref(t.integer(), () => projects.cols.id, {
      onDelete: "cascade",
    }),
    name: t.string({ maxLength: 100 }),
    /**
     * Hashed API key token (Argon2 format).
     * The raw token is only shown once at creation time.
     */
    tokenHash: t.string({ maxLength: 256 }),
    /**
     * Last 4 characters of the token for display purposes.
     */
    tokenSuffix: t.string({ maxLength: 4 }),
    /**
     * Roles copied from the user at creation time.
     */
    roles: t.array(t.string()),
    /**
     * Last time the key was used.
     */
    lastUsedAt: t.optional(t.datetime()),
    /**
     * Optional expiration date.
     */
    expiresAt: t.optional(t.datetime()),
  }),
  indexes: [
    {
      columns: ["projectId", "name"],
      unique: true,
    },
    {
      columns: ["tokenHash"],
      unique: true,
    },
  ],
});

export type McpApiKey = Static<typeof mcpApiKeys.schema>;
