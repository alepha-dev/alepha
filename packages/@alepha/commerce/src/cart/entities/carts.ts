import type { Infer } from "alepha";
import { z } from "alepha";
import { $entity, db } from "alepha/orm";

/**
 * A server-side basket.
 *
 * Server-side rather than client-side because a basket that lives in
 * localStorage cannot be recovered on another device, cannot be reminded about
 * when abandoned, and cannot have its prices re-checked. `token` is what an
 * anonymous visitor carries in a signed cookie; `userId` is set once they sign
 * in, and {@link CartService.merge} folds the anonymous cart into theirs.
 */
export const carts = $entity({
  name: "commerce_carts",
  schema: z.object({
    id: db.primaryKey(z.uuid()),
    version: db.version(),
    createdAt: db.createdAt(),
    updatedAt: db.updatedAt(),
    organizationId: db.organization(),

    /** Opaque handle for an anonymous visitor. */
    token: z.text({ minLength: 16, maxLength: 128 }),

    /** Set once the visitor authenticates. */
    userId: z.uuid().optional(),

    /**
     * When this cart may be swept. Held here rather than derived from
     * `updatedAt` so the lifetime is a decision the app can vary (a longer one
     * for signed-in users, say) instead of a constant buried in a job.
     */
    expiresAt: z.text(),
  }),
  indexes: [
    { columns: ["token"], unique: true },
    { columns: ["organizationId", "userId"] },
    { columns: ["expiresAt"] },
  ],
});

export type CartEntity = Infer<typeof carts.schema>;
