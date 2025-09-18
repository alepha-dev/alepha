import type { TObject, TOptional } from "@alepha/core";
import { t } from "@alepha/core";
import { PG_DEFAULT } from "../constants/PG_SYMBOLS.ts";
import { schema } from "../types/schema.ts";

/**
 * Transforms a TObject schema for insert operations.
 * All default properties at the root level are made optional.
 *
 * @example
 * Before: { name: string; age: number(default=0); }
 * After:  { name: string; age?: number; }
 */
export type TObjectInsert<T extends TObject> = TObject<{
	[K in keyof T["properties"]]: T["properties"][K] extends
		| { [PG_DEFAULT]: any }
		| { "~optional": true }
		? TOptional<T["properties"][K]>
		: T["properties"][K];
}>;

export const insertSchema = <T extends TObject>(obj: T): TObjectInsert<T> => {
	const newProperties: Record<string, any> = {};

	for (const key in obj.properties) {
		const prop = obj.properties[key];

		if (PG_DEFAULT in prop) {
			newProperties[key] = t.optional(prop);
		} else {
			newProperties[key] = prop;
		}
	}

	return t.object(
		newProperties,
		"options" in schema && typeof schema.options === "object"
			? { ...schema.options }
			: {},
	) as TObjectInsert<T>;
};
