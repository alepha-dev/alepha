import type { Static } from "alepha";
import { z } from "alepha";
import { $entity, db } from "../../core/index.ts";

export const bigEntity = $entity({
  name: "big_entity",
  schema: z.object({
    id: db.primaryKey(z.bigint()),
    type: z.enum(["big_entity"]),
    date: z.date(),
    a: z.text(),
    b: z.number(),
    c: z.integer(),
    d: z.boolean(),
    e: z.object({
      a: z.text(),
      b: z.number(),
      c: z.integer(),
      d: z.boolean(),
      e: z.object({
        a: z.text(),
        b: z.number(),
        c: z.integer(),
        d: z.boolean(),
        j: z.array(
          z.object({
            a: z.text(),
            b: z.number(),
            c: z.integer(),
            d: z.boolean(),
            e: z.object({
              a: z.text(),
              b: z.number(),
              c: z.integer(),
              d: z.boolean(),
            }),
          }),
        ),
      }),
    }),
    f: z.array(z.text()),
    g: z.array(z.number()),
    h: z.array(z.integer()),
    i: z.array(z.boolean()),
    j: z.array(
      z.object({
        a: z.text(),
        b: z.number(),
        c: z.integer(),
        d: z.boolean(),
        e: z.object({
          a: z.text(),
          b: z.number(),
          c: z.integer(),
          d: z.boolean(),
        }),
      }),
    ),
    k: z.datetime(),
    l: z.uuid(),
    m: z.enum(["a", "b", "c"]),
  }),
});

export type BigEntity = Static<typeof bigEntity.schema>;
