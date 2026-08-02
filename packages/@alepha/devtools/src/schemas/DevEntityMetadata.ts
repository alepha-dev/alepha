import { type Infer, z } from "alepha";

export const devEntityColumnSchema = z.object({
  name: z.text(),
  type: z.text(),
  nullable: z.boolean(),
  primaryKey: z.boolean(),
  identity: z.boolean(),
  createdAt: z.boolean(),
  updatedAt: z.boolean(),
  deletedAt: z.boolean(),
  version: z.boolean(),
  hasDefault: z.boolean(),
  ref: z
    .object({
      entity: z.text(),
      column: z.text(),
      onUpdate: z.text().optional(),
      onDelete: z.text().optional(),
    })
    .optional(),
});

export const devEntityIndexSchema = z.object({
  name: z.text().optional(),
  columns: z.array(z.text()),
  unique: z.boolean(),
});

export const devEntityForeignKeySchema = z.object({
  name: z.text().optional(),
  columns: z.array(z.text()),
  foreignEntity: z.text(),
  foreignColumns: z.array(z.text()),
});

export const devEntityConstraintSchema = z.object({
  name: z.text().optional(),
  columns: z.array(z.text()),
  unique: z.boolean(),
  hasCheck: z.boolean(),
});

export const devEntityMetadataSchema = z.object({
  name: z.text(),
  provider: z.text(),
  columns: z.array(devEntityColumnSchema),
  indexes: z.array(devEntityIndexSchema),
  foreignKeys: z.array(devEntityForeignKeySchema),
  constraints: z.array(devEntityConstraintSchema),
  schema: z.any().optional(),
  insertSchema: z.any().optional(),
  updateSchema: z.any().optional(),
});

export type DevEntityColumn = Infer<typeof devEntityColumnSchema>;
export type DevEntityIndex = Infer<typeof devEntityIndexSchema>;
export type DevEntityForeignKey = Infer<typeof devEntityForeignKeySchema>;
export type DevEntityConstraint = Infer<typeof devEntityConstraintSchema>;
export type DevEntityMetadata = Infer<typeof devEntityMetadataSchema>;
