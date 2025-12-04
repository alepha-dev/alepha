import { type Static, t } from "alepha";
import { $entity, pg } from "alepha/orm";

export const stations = $entity({
  name: "stations",
  schema: t.object({
    id: pg.primaryKey(t.uuid()),
    createdAt: pg.createdAt(),
    updatedAt: pg.updatedAt(),

    name: t.text(),
    code: t.text({ minLength: 3, maxLength: 10 }),
    city: t.text(),
    country: t.text(),
  }),
  indexes: [{ columns: ["code"], unique: true }],
});

export type Station = Static<typeof stations.schema>;
