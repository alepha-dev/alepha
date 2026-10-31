import type { Infer } from "alepha";
import { z } from "alepha";
import { $entity, db } from "alepha/orm";

/**
 * A shelf of the catalogue. A tree: `parentId` names the shelf above, and a
 * listing of a category takes in everything under it.
 *
 * `products.categoryId` stays a plain uuid rather than growing a reference: a
 * foreign key on an existing column is a table rebuild on SQLite, and
 * `CategoryService.delete` already refuses to leave a product pointing at
 * nothing.
 */
export const categories = $entity({
  name: "commerce_categories",
  schema: z.object({
    id: db.primaryKey(z.uuid()),
    version: db.version(),
    createdAt: db.createdAt(),
    updatedAt: db.updatedAt(),

    parentId: z.uuid().optional(),

    /**
     * URL-safe, unique: what a storefront routes and filters on.
     */
    slug: z.text({ minLength: 1, maxLength: 200 }),
    name: z.text({ minLength: 1, maxLength: 200 }),
    description: z.text({ maxLength: 4000 }).optional(),

    /**
     * Lower sorts first, among siblings.
     */
    position: db.default(z.integer(), 0),

    /**
     * Draft shelves are invisible to the public list.
     */
    published: db.default(z.boolean(), true),
  }),
  indexes: [{ columns: ["slug"], unique: true }, { columns: ["parentId"] }],
});

export type CategoryEntity = Infer<typeof categories.schema>;
