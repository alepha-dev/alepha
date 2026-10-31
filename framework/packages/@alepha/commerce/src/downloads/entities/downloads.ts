import type { Infer } from "alepha";
import { z } from "alepha";
import { $entity, db } from "alepha/orm";

/**
 * The right to collect one paid order line: what a download link stands for.
 *
 * One per line, issued the first time anybody asks for the order's links. The
 * `token` is the credential a guest has: random, unguessable, and useless once
 * the row says so. A row rather than a self-contained signed link, because a
 * link has to stop on a refund and count its uses, and neither of those can be
 * written into a URL that has already been sent.
 */
export const downloads = $entity({
  name: "commerce_downloads",
  schema: z.object({
    id: db.primaryKey(z.uuid()),
    createdAt: db.createdAt(),
    updatedAt: db.updatedAt(),

    orderId: z.uuid(),
    orderItemId: z.uuid(),

    /**
     * A snapshot of the line's file: a product can change its file later, and
     * this buyer paid for that one.
     */
    fileId: z.uuid(),
    name: z.text({ maxLength: 200 }),

    token: z.text({ minLength: 16, maxLength: 128 }),

    expiresAt: z.text(),

    /**
     * How many times it was downloaded, and how many it may be.
     */
    count: db.default(z.integer().min(0), 0),
    maxCount: z.integer().min(1),
  }),
  indexes: [
    { columns: ["token"], unique: true },
    { columns: ["orderItemId"], unique: true },
    { columns: ["orderId"] },
  ],
});

export type DownloadEntity = Infer<typeof downloads.schema>;
