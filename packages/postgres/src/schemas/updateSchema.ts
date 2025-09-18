import {
	type TNull,
	type TObject,
	type TOptional,
	type TUnion,
	t,
} from "@alepha/core";

/**
 * Transforms a TObject schema for update operations.
 * All optional properties at the root level are made nullable (i.e., `T | null`).
 * This allows an API endpoint to explicitly accept `null` to clear an optional field in the database.
 *
 * @example
 * Before: { name?: string; age: number; }
 * After:  { name?: string | null; age: number; }
 */
export type TObjectUpdate<T extends TObject> = TObject<{
	[K in keyof T["properties"]]: T["properties"][K] extends TOptional<infer U>
		? TOptional<TUnion<[U, TNull]>>
		: T["properties"][K];
}>;

export const updateSchema = <T extends TObject>(
	schema: T,
): TObjectUpdate<T> => {
	const newProperties: Record<string, any> = {};

	for (const key in schema.properties) {
		const prop = schema.properties[key];
		if (t.schema.isOptional(prop)) {
			newProperties[key] = t.optional(t.union([prop, t.raw.Null()]));
		} else {
			newProperties[key] = prop;
		}
	}

	return t.object(
		newProperties,
		"options" in schema && typeof schema.options === "object"
			? { ...schema.options }
			: {},
	) as TObjectUpdate<T>;
};
