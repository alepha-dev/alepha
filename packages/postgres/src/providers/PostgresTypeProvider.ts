import { t } from "@alepha/core";
import type {
	IntegerOptions,
	NumberOptions,
	ObjectOptions,
	Static,
	StringOptions,
	TArray,
	TObject,
	TOptionalWithFlag,
	TProperties,
	TSchema,
} from "@sinclair/typebox";
import type { TableConfig } from "drizzle-orm/pg-core";
import type { UpdateDeleteAction } from "drizzle-orm/pg-core/foreign-keys";
import {
	PG_CREATED_AT,
	PG_DEFAULT,
	PG_IDENTITY,
	PG_MANY,
	PG_PRIMARY_KEY,
	PG_REF,
	PG_UPDATED_AT,
	PG_VERSION,
	type PgDefault,
	type PgIdentityOptions,
	type PgMany,
	type PgRef,
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

	public readonly identityPrimaryKey = (
		identity?: PgIdentityOptions,
		options?: IntegerOptions,
	) =>
		pgAttr(
			pgAttr(pgAttr(t.int(options), PG_PRIMARY_KEY), PG_IDENTITY, identity),
			PG_DEFAULT,
		);

	public readonly bigIdentityPrimaryKey = (
		identity?: PgIdentityOptions,
		options?: NumberOptions,
	) =>
		pgAttr(
			pgAttr(pgAttr(t.number(options), PG_PRIMARY_KEY), PG_IDENTITY, identity),
			PG_DEFAULT,
		);

	public readonly uuidPrimaryKey = () =>
		pgAttr(pgAttr(t.uuid(), PG_PRIMARY_KEY), PG_DEFAULT);

	public readonly primaryKey = this.bigIdentityPrimaryKey;

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
	 * @deprecated Build your own entity schema.
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
	 * Creates an insert schema for a given object schema.
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
	 * Creates a page schema for a given object schema.
	 */
	public readonly page = <T extends TObject>(
		resource: T,
		options?: ObjectOptions,
	): TPage<T> => {
		return pageSchema(resource, options);
	};

	/**
	 * Creates a reference to another table or schema.
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
	 * Creates a reference to another table or schema with a foreign key.
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
}

export const pg = new PostgresTypeProvider();

Object.assign(t, { pg });
