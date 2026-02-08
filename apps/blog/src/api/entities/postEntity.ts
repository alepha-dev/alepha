import { type Static, t } from "alepha";
import { users } from "alepha/api/users";
import { $entity, db } from "alepha/orm";
import { categoryEntity } from "./categoryEntity.ts";

export const postStatusSchema = t.enum(["draft", "published", "archived"]);

export const postEntity = $entity({
  name: "posts",
  schema: t.object({
    id: db.primaryKey(t.uuid()),
    createdAt: db.createdAt(),
    updatedAt: db.updatedAt(),

    title: t.text({ minLength: 1, maxLength: 200 }),
    slug: t.text({ minLength: 1, maxLength: 250 }),
    content: t.text({ maxLength: 100_000 }),
    excerpt: t.optional(t.text({ maxLength: 1000 })),

    coverImageId: t.optional(t.uuid()),
    authorId: db.ref(t.uuid(), () => users.cols.id),
    categoryId: db.ref(t.optional(t.uuid()), () => categoryEntity.cols.id),

    status: db.default(postStatusSchema, "draft"),
    publishedAt: t.optional(t.datetime()),
    tags: db.default(t.array(t.text()), []),
    featured: db.default(t.boolean(), false),
    viewCount: db.default(t.integer(), 0),
  }),
  indexes: [
    { column: "slug", unique: true },
    "authorId",
    "categoryId",
    "status",
    { columns: ["status", "publishedAt"] },
    "featured",
  ],
});

export type PostEntity = Static<typeof postEntity.schema>;
