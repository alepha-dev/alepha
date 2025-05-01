import type { Static } from "@alepha/core";
import { t } from "@alepha/core";
import type { TObject, TProperties } from "@sinclair/typebox";
import { createdAtSchema } from "./createdAtSchema";
import { legacyIdSchema } from "./legacyIdSchema";
import { updatedAtSchema } from "./updatedAtSchema";

/**
 * Entity Schema.
 *
 * Add some common SQL properties to an object.
 */
export const entitySchema = t.object({
	id: legacyIdSchema,
	createdAt: createdAtSchema,
	updatedAt: updatedAtSchema,
});

/**
 * TypeBox Entity Type.
 */
export type TEntity<T extends TProperties> = TObject<
	T & {
		id: typeof legacyIdSchema;
		createdAt: typeof createdAtSchema;
		updatedAt: typeof updatedAtSchema;
	}
>;

/**
 * The base entity.
 */
export type BaseEntity = Static<typeof entitySchema>;

/**
 *  The keys of the base entity.
 */
export type BaseEntityKeys = keyof BaseEntity;

/**
 *  The keys of the base entity.
 */
export const entityKeys = ["id", "createdAt", "updatedAt"] as const;
