import type { Static, TObject } from "@sinclair/typebox";
import {
	type PgTableExtraConfigValue,
	index,
	uniqueIndex,
} from "drizzle-orm/pg-core";
import { $table } from "../helpers/pgTableSchema.ts";

export interface EntityDescriptorOptions<
	T extends TObject,
	Keys = keyof Static<T>,
> {
	name: string;
	schema: T;
	indexes?: (
		| Keys
		| {
				column: Keys;
				unique?: boolean;
				name?: string;
		  }
	)[];
	foreignKeys?: {
		columns: Keys[];
		foreignTable: string;
		foreignColumns: Keys[];
		onUpdate?:
			| "cascade"
			| "restrict"
			| "no action"
			| "set null"
			| "set default";
		onDelete?:
			| "cascade"
			| "restrict"
			| "no action"
			| "set null"
			| "set default";
	}[];
	config?: PgTableExtraConfigValue[];
}

/**
 * Creates a table descriptor for drizzle-orm.
 */
export const $entity = <T extends TObject>(
	options: EntityDescriptorOptions<T>,
) => {
	return $table(options.name, options.schema, (t) => {
		const config: PgTableExtraConfigValue[] = [...(options.config ?? [])];

		if (options.indexes) {
			for (const v of options.indexes) {
				if (typeof v === "string") {
					const name = `idx_${options.name}_${v}`;
					index(name).on(t[v]);
				} else if (typeof v === "object") {
					const name = v.name ?? `idx_${options.name}_${String(v.column)}`;
					const idx = v.unique ? uniqueIndex(name) : index(name);
					idx.on(t[v.column]);
					config.push(idx);
				}
			}
		}

		if (options.foreignKeys) {
			for (const foreignKey of options.foreignKeys) {
				// TODO: map foreignKey to drizzle-orm foreign key
			}
		}

		return [];
	});
};
