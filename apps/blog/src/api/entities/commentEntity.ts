import { type Static, t } from "alepha";
import { users } from "alepha/api/users";
import { $entity, db } from "alepha/orm";
import { postEntity } from "./postEntity.ts";

export const commentStatusSchema = t.enum([
  "pending",
  "approved",
  "spam",
  "rejected",
]);

export const commentEntity = $entity({
  name: "comments",
  schema: t.object({
    id: db.primaryKey(t.uuid()),
    createdAt: db.createdAt(),
    updatedAt: db.updatedAt(),

    postId: db.ref(t.uuid(), () => postEntity.cols.id),
    authorId: db.ref(t.uuid(), () => users.cols.id),
    content: t.text({ minLength: 1, maxLength: 5000 }),
    status: db.default(commentStatusSchema, "pending"),
    parentId: db.ref(t.optional(t.uuid()), () => commentEntity.cols.id),
  }),
  indexes: [
    { columns: ["postId", "status"] },
    "authorId",
    "status",
    "parentId",
  ],
});

export type CommentEntity = Static<typeof commentEntity.schema>;
