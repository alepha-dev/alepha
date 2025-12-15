import { type Static, t } from "alepha";

export const devEntityColumnSchema = t.object({
  name: t.text(),
  type: t.text(),
  nullable: t.boolean(),
  primaryKey: t.boolean(),
  identity: t.boolean(),
  createdAt: t.boolean(),
  updatedAt: t.boolean(),
  deletedAt: t.boolean(),
  version: t.boolean(),
  hasDefault: t.boolean(),
  ref: t.optional(
    t.object({
      entity: t.text(),
      column: t.text(),
      onUpdate: t.optional(t.text()),
      onDelete: t.optional(t.text()),
    }),
  ),
});

export const devEntityIndexSchema = t.object({
  name: t.optional(t.text()),
  columns: t.array(t.text()),
  unique: t.boolean(),
});

export const devEntityForeignKeySchema = t.object({
  name: t.optional(t.text()),
  columns: t.array(t.text()),
  foreignEntity: t.text(),
  foreignColumns: t.array(t.text()),
});

export const devEntityConstraintSchema = t.object({
  name: t.optional(t.text()),
  columns: t.array(t.text()),
  unique: t.boolean(),
  hasCheck: t.boolean(),
});

export const devEntityMetadataSchema = t.object({
  name: t.text(),
  provider: t.text(),
  columns: t.array(devEntityColumnSchema),
  indexes: t.array(devEntityIndexSchema),
  foreignKeys: t.array(devEntityForeignKeySchema),
  constraints: t.array(devEntityConstraintSchema),
});

export type DevEntityColumn = Static<typeof devEntityColumnSchema>;
export type DevEntityIndex = Static<typeof devEntityIndexSchema>;
export type DevEntityForeignKey = Static<typeof devEntityForeignKeySchema>;
export type DevEntityConstraint = Static<typeof devEntityConstraintSchema>;
export type DevEntityMetadata = Static<typeof devEntityMetadataSchema>;
