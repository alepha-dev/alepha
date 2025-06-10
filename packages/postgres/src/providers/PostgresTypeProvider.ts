import type { Static } from "@alepha/core";
import { t } from "@alepha/core";
import type {
	IntegerOptions,
	ObjectOptions,
	StringOptions,
	TArray,
	TObject,
	TOptionalWithFlag,
	TProperties,
	TSchema,
} from "@sinclair/typebox";
import type { TableConfig } from "drizzle-orm/pg-core";
import type { UpdateDeleteAction } from "drizzle-orm/pg-core/foreign-keys";
import type { PgDefault, PgMany, PgRef } from "../constants/PG_SYMBOLS.ts";
import {
	PG_CREATED_AT,
	PG_DEFAULT,
	PG_IDENTITY,
	PG_MANY,
	PG_PRIMARY_KEY,
	PG_REF,
	PG_SERIAL,
	PG_UPDATED_AT,
	PG_VERSION,
} from "../constants/PG_SYMBOLS.ts";
import type { PgTableWithColumnsAndSchema } from "../helpers/schemaToColumns.ts";
import type { TInsertObject } from "../interfaces/TInsertObject.ts";
import type { TEntity } from "../schemas/entitySchema.ts";
import { legacyIdSchema } from "../schemas/legacyIdSchema.ts";
import type { TPage } from "../schemas/pageSchema.ts";
import { pageSchema } from "../schemas/pageSchema.ts";
import type { PgAttr } from "../schemas/pgAttr.ts";
import { pgAttr } from "../schemas/pgAttr.ts";

declare module "@alepha/core" {
	interface TypeProvider {
		pg: PostgresTypeProvider;
	}
}

export class PostgresTypeProvider {
	public readonly attr = pgAttr;

	public readonly serial = () => pgAttr(t.int(), PG_SERIAL);

	public readonly identity = (options?: IntegerOptions) =>
		pgAttr(t.int(options), PG_IDENTITY);

	public readonly id = (options?: IntegerOptions) =>
		this.primaryKey(this.identity(options));

	public readonly identityPrimaryKey = (options?: IntegerOptions) =>
		pgAttr(
			pgAttr(pgAttr(t.int(options), PG_PRIMARY_KEY), PG_IDENTITY),
			PG_DEFAULT,
		);

	public readonly uuidPrimaryKey = () =>
		pgAttr(pgAttr(t.uuid(), PG_PRIMARY_KEY), PG_DEFAULT);

	public readonly primaryKey = this.identityPrimaryKey;

	/**
	 *
	 * @param type
	 * @param value
	 */
	public readonly default = <T extends TSchema>(
		type: T,
		value?: Static<T>,
	): PgAttr<T, PgDefault> => {
		if (value != null) {
			Object.assign(type, { default: value });
		}
		return this.attr(type, PG_DEFAULT);
	};

	/**
	 *
	 * @param options
	 */
	public readonly version = (options: IntegerOptions = {}) =>
		this.default(pgAttr(t.int(options), PG_VERSION), 0);

	/**
	 *
	 * @param options
	 */
	public readonly createdAt = (options?: StringOptions) =>
		pgAttr(pgAttr(t.datetime(options), PG_CREATED_AT), PG_DEFAULT);

	/**
	 *
	 * @param options
	 */
	public readonly updatedAt = (options?: StringOptions) =>
		pgAttr(pgAttr(t.datetime(options), PG_UPDATED_AT), PG_DEFAULT);

	/**
	 *
	 * @param properties
	 * @param options
	 */
	public readonly entity = <T extends TProperties>(
		properties: T,
		options?: ObjectOptions,
	): TEntity<T> => {
		return t.object(
			{
				id: legacyIdSchema,
				createdAt: this.createdAt(),
				updatedAt: this.updatedAt(),
				...properties,
			},
			options,
		);
	};

	/**
	 *
	 * @param obj
	 */
	public readonly insert = <T extends TObject>(obj: T): TInsertObject<T> => {
		const properties: Record<string, TSchema> = {};
		const required: string[] = [];

		for (const key in obj.properties) {
			const prop = obj.properties[key];

			if (PG_MANY in prop) {
				continue;
			}

			if (PG_DEFAULT in prop) {
				properties[key] = t.optional(prop);
			} else {
				properties[key] = prop;
				if (obj.required?.includes(key)) {
					required.push(key);
				}
			}
		}

		return {
			...obj,
			required,
			properties,
		} as unknown as TInsertObject<T>;
	};

	/**
	 * @alias insert
	 */
	public readonly input = this.insert;

	/**
	 *
	 * @param resource
	 * @param options
	 */
	public readonly page = <T extends TObject>(
		resource: T,
		options?: ObjectOptions,
	): TPage<T> => {
		return pageSchema(resource, options);
	};

	/**
	 *
	 * @param type
	 * @param ref
	 * @param actions
	 */
	public readonly ref = <T extends TSchema>(
		type: T,
		ref: () => any,
		actions?: {
			onUpdate?: UpdateDeleteAction;
			onDelete?: UpdateDeleteAction;
		},
	): PgAttr<T, PgRef> => {
		return this.attr(type, PG_REF, {
			ref,
			actions,
		});
	};
	references = this.ref;

	/**
	 *
	 * @param table
	 * @param foreignKey
	 */
	public readonly many = <T extends TObject, Config extends TableConfig>(
		table: PgTableWithColumnsAndSchema<Config, T>,
		foreignKey: keyof T["properties"],
	): TOptionalWithFlag<PgAttr<PgAttr<TArray<T>, PgMany>, PgDefault>, true> => {
		return this.attr(
			this.attr(t.optional(t.array(table.$schema)), PG_DEFAULT),
			PG_MANY,
			{
				table,
				schema: table.$schema,
				foreignKey: foreignKey as string,
			},
		);
	};

	// public readonly many2 = <T extends TObject, Config extends TableConfig>(
	// 	schema: T,
	// 	ref: () => any,
	// ): TOptionalWithFlag<PgAttr<PgAttr<TArray<T>, PgMany>, PgDefault>, true> => {
	// 	return this.attr(
	// 		this.attr(t.optional(t.array(schema)), PG_DEFAULT),
	// 		PG_MANY,
	// 		{
	// 			ref,
	// 			schema,
	// 		},
	// 	);
	// };
}

export const pg = new PostgresTypeProvider();

Object.assign(t, { pg });
