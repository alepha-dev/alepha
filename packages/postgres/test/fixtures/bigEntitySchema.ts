import type { Static } from "@alepha/core";
import { t } from "@alepha/core";
import { $entity, pg } from "../../src";

export const bigEntity = $entity({
	name: "big_entity",
	schema: t.object({
		id: pg.primaryKey(t.bigint()),
		a: t.string(),
		b: t.number(),
		c: t.int(),
		d: t.boolean(),
		e: t.object({
			a: t.string(),
			b: t.number(),
			c: t.int(),
			d: t.boolean(),
			e: t.object({
				a: t.string(),
				b: t.number(),
				c: t.int(),
				d: t.boolean(),
				j: t.array(
					t.object({
						a: t.string(),
						b: t.number(),
						c: t.int(),
						d: t.boolean(),
						e: t.object({
							a: t.string(),
							b: t.number(),
							c: t.int(),
							d: t.boolean(),
						}),
					}),
				),
			}),
		}),
		f: t.array(t.string()),
		g: t.array(t.number()),
		h: t.array(t.int()),
		i: t.array(t.boolean()),
		j: t.array(
			t.object({
				a: t.string(),
				b: t.number(),
				c: t.int(),
				d: t.boolean(),
				e: t.object({
					a: t.string(),
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
