import { type Static, t } from "alepha";
import { pageQuerySchema } from "alepha/orm";
import { postStatusSchema } from "../entities/postEntity.ts";

export const postResourceSchema = t.object({
  id: t.uuid(),
  createdAt: t.datetime(),
  updatedAt: t.datetime(),
  title: t.text(),
  slug: t.text(),
  content: t.text({ maxLength: 100_000 }),
  excerpt: t.optional(t.text({ maxLength: 1000 })),
  coverImageId: t.optional(t.uuid()),
  authorId: t.uuid(),
  authorName: t.optional(t.text()),
  authorEmail: t.optional(t.text()),
  categoryId: t.optional(t.uuid()),
  categoryName: t.optional(t.text()),
  status: postStatusSchema,
  publishedAt: t.optional(t.datetime()),
  tags: t.array(t.text()),
  featured: t.boolean(),
  viewCount: t.integer(),
});

export type PostResource = Static<typeof postResourceSchema>;

export const postCreateSchema = t.object({
  title: t.text({ minLength: 1, maxLength: 200 }),
  content: t.text({ maxLength: 100_000 }),
  excerpt: t.optional(t.text({ maxLength: 1000 })),
  slug: t.optional(t.text({ maxLength: 250 })),
  categoryId: t.optional(t.uuid()),
  tags: t.optional(t.array(t.text())),
  status: t.optional(postStatusSchema),
  featured: t.optional(t.boolean()),
  coverImageId: t.optional(t.uuid()),
});

export type PostCreate = Static<typeof postCreateSchema>;

export const postUpdateSchema = t.object({
  title: t.optional(t.text({ minLength: 1, maxLength: 200 })),
  content: t.optional(t.text({ maxLength: 100_000 })),
  excerpt: t.optional(t.text({ maxLength: 1000 })),
  slug: t.optional(t.text({ maxLength: 250 })),
  categoryId: t.optional(t.uuid()),
  tags: t.optional(t.array(t.text())),
  status: t.optional(postStatusSchema),
  featured: t.optional(t.boolean()),
  coverImageId: t.optional(t.uuid()),
});

export type PostUpdate = Static<typeof postUpdateSchema>;

export const postQuerySchema = t.extend(pageQuerySchema, {
  status: t.optional(postStatusSchema),
  categoryId: t.optional(t.uuid()),
  tag: t.optional(t.text()),
  authorId: t.optional(t.uuid()),
  featured: t.optional(t.boolean()),
  search: t.optional(t.text()),
});

export type PostQuery = Static<typeof postQuerySchema>;

export const dashboardStatsSchema = t.object({
  totalPosts: t.integer(),
  publishedPosts: t.integer(),
  draftPosts: t.integer(),
  totalComments: t.integer(),
  pendingComments: t.integer(),
  totalViews: t.integer(),
  recentPosts: t.array(postResourceSchema),
});

export type DashboardStats = Static<typeof dashboardStatsSchema>;
