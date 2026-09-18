import { type Infer, z } from "alepha";
import { $entity, db } from "alepha/orm";

export const organizations = $entity({
  name: "organizations",
  schema: z.object({
    id: db.primaryKey(z.uuid()),
    createdAt: db.createdAt(),
    updatedAt: db.updatedAt(),
    name: z.string().min(1).max(100),
    slug: z.string().min(1).max(100).optional(),
    logo: z.uuid().optional(),
    metadata: z.record(z.string(), z.any()).optional(),
  }),
  indexes: [{ columns: ["slug"], unique: true }],
});

export type Organization = Infer<typeof organizations.schema>;
