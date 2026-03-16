import { type Static, t } from "alepha";
import { $entity, db } from "alepha/orm";
import { users } from "./users.ts";

export const posts = $entity({
  name: "posts",
  schema: t.object({
    id: db.primaryKey(t.integer()),
    createdAt: db.createdAt(),
    updatedAt: db.updatedAt(),
    deletedAt: db.deletedAt(),
    slug: t.shortText(),
    title: t.text(),
    summary: t.text(),
    content: t.richText(),
    contentHtml: t.richText(),
    coverImage: t.optional(t.string()),
    tags: db.default(t.array(t.string()), []),
    publishedAt: t.optional(t.datetime()),
    authorId: db.ref(t.uuid(), () => users.cols.id, { onDelete: "set null" }),
  }),
  indexes: [
    { columns: ["slug"], unique: true },
    { columns: ["publishedAt"] },
    { columns: ["deletedAt"] },
  ],
});

export type Post = Static<typeof posts.schema>;
