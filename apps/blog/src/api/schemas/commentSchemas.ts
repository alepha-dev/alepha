import { type Static, t } from "alepha";
import { pageQuerySchema } from "alepha/orm";
import { commentStatusSchema } from "../entities/commentEntity.ts";

export const commentResourceSchema = t.object({
  id: t.uuid(),
  createdAt: t.datetime(),
  updatedAt: t.datetime(),
  postId: t.uuid(),
  postTitle: t.optional(t.text()),
  postSlug: t.optional(t.text()),
  authorId: t.uuid(),
  authorName: t.optional(t.text()),
  authorEmail: t.optional(t.text()),
  content: t.text(),
  status: commentStatusSchema,
  parentId: t.optional(t.uuid()),
});

export type CommentResource = Static<typeof commentResourceSchema>;

export const commentCreateSchema = t.object({
  content: t.text({ minLength: 1, maxLength: 5000 }),
  parentId: t.optional(t.uuid()),
});

export type CommentCreate = Static<typeof commentCreateSchema>;

export const commentQuerySchema = t.extend(pageQuerySchema, {
  postId: t.optional(t.uuid()),
  status: t.optional(commentStatusSchema),
  authorId: t.optional(t.uuid()),
  search: t.optional(t.text()),
});

export type CommentQuery = Static<typeof commentQuerySchema>;
