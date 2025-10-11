import type { Static } from "@alepha/core";
import { t } from "@alepha/core";
import { $entity, pg } from "../../src";

export const bigEntity = $entity({
	name: "big_entity",
	schema: t.object({
		id: pg.primaryKey(t.bigint()),
		type: t.enum(["big_entity"]),
		a: t.text(),
		b: t.number(),
		c: t.int(),
		d: t.boolean(),
		e: t.object({
			a: t.text(),
			b: t.number(),
			c: t.int(),
			d: t.boolean(),
			e: t.object({
				a: t.text(),
				b: t.number(),
				c: t.int(),
				d: t.boolean(),
				j: t.array(
					t.object({
						a: t.text(),
						b: t.number(),
						c: t.int(),
						d: t.boolean(),
						e: t.object({
							a: t.text(),
							b: t.number(),
							c: t.int(),
							d: t.boolean(),
						}),
					}),
				),
			}),
		}),
		f: t.array(t.text()),
		g: t.array(t.number()),
		h: t.array(t.int()),
		i: t.array(t.boolean()),
		j: t.array(
			t.object({
				a: t.text(),
				b: t.number(),
				c: t.int(),
				d: t.boolean(),
				e: t.object({
					a: t.text(),
					b: t.number(),
					c: t.int(),
					d: t.boolean(),
				}),
			}),
		),
		k: t.datetime(),
		l: t.uuid(),
		m: t.enum(["a", "b", "c"]),
	}),
});

export type BigEntity = Static<typeof bigEntity.$schema>;
