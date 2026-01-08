import type { Static } from "alepha";
import { t } from "alepha";
import { $entity, db } from "../../index.ts";

export const bigEntity = $entity({
  name: "big_entity",
  schema: t.object({
    id: db.primaryKey(t.bigint()),
    type: t.enum(["big_entity"]),
    date: t.date(),
    a: t.text(),
    b: t.number(),
    c: t.integer(),
    d: t.boolean(),
    e: t.object({
      a: t.text(),
      b: t.number(),
      c: t.integer(),
      d: t.boolean(),
      e: t.object({
        a: t.text(),
        b: t.number(),
        c: t.integer(),
        d: t.boolean(),
        j: t.array(
          t.object({
            a: t.text(),
            b: t.number(),
            c: t.integer(),
            d: t.boolean(),
            e: t.object({
              a: t.text(),
              b: t.number(),
              c: t.integer(),
              d: t.boolean(),
            }),
          }),
        ),
      }),
    }),
    f: t.array(t.text()),
    g: t.array(t.number()),
    h: t.array(t.integer()),
    i: t.array(t.boolean()),
    j: t.array(
      t.object({
        a: t.text(),
        b: t.number(),
        c: t.integer(),
        d: t.boolean(),
        e: t.object({
          a: t.text(),
          b: t.number(),
          c: t.integer(),
          d: t.boolean(),
        }),
      }),
    ),
    k: t.datetime(),
    l: t.uuid(),
    m: t.enum(["a", "b", "c"]),
  }),
});

export type BigEntity = Static<typeof bigEntity.schema>;
