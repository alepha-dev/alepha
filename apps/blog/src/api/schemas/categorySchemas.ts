import { type Static, t } from "alepha";

export const categoryResourceSchema = t.object({
  id: t.uuid(),
  createdAt: t.datetime(),
  updatedAt: t.datetime(),
  name: t.text(),
  slug: t.text(),
  description: t.optional(t.text()),
  color: t.optional(t.text()),
});

export type CategoryResource = Static<typeof categoryResourceSchema>;

export const categoryCreateSchema = t.object({
  name: t.text({ minLength: 1, maxLength: 100 }),
  slug: t.optional(t.text({ maxLength: 120 })),
  description: t.optional(t.text({ maxLength: 500 })),
  color: t.optional(t.text()),
});

export type CategoryCreate = Static<typeof categoryCreateSchema>;

export const categoryUpdateSchema = t.object({
  name: t.optional(t.text({ minLength: 1, maxLength: 100 })),
  slug: t.optional(t.text({ maxLength: 120 })),
  description: t.optional(t.text({ maxLength: 500 })),
  color: t.optional(t.text()),
});

export type CategoryUpdate = Static<typeof categoryUpdateSchema>;
