import { TypeGuard, t } from "@alepha/core";
import { PRIMITIVE } from "@alepha/core/src/constants/PRIMITIVE.ts";
import type {
	IntegerOptions,
	NumberOptions,
	ObjectOptions,
	Static,
	StringOptions,
	TArray,
	TInteger,
	TNumber,
	TObject,
	TOptionalWithFlag,
	TProperties,
	TSchema,
	TString,
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
	type PgPrimaryKey,
	type PgRef,
} from "../constants/PG_SYMBOLS.ts";
import type { PgAttr } from "../helpers/pgAttr.ts";
import { pgAttr } from "../helpers/pgAttr.ts";
import type { PgTableWithColumnsAndSchema } from "../helpers/schemaToPgColumns.ts";
import type { TInsertObject } from "../interfaces/TInsertObject.ts";
import type { TEntity } from "../schemas/entitySchema.ts";
import { legacyIdSchema } from "../schemas/legacyIdSchema.ts";
import type { TPage } from "../schemas/pageSchema.ts";
import { pageSchema } from "../schemas/pageSchema.ts";

declare module "@alepha/core" {
	interface TypeProvider {
		pg: PostgresTypeProvider;
	}
}

export class PostgresTypeProvider {
	public readonly attr = pgAttr;

	/**
	 * Creates a primary key with an identity column.
	 */
	public readonly identityPrimaryKey = (
		identity?: PgIdentityOptions,
		options?: IntegerOptions,
	) =>
		pgAttr(
			pgAttr(pgAttr(t.int(options), PG_PRIMARY_KEY), PG_IDENTITY, identity),
			PG_DEFAULT,
		);

	/**
	 * Creates a primary key with a big identity column. (default)
	 */
	public readonly bigIdentityPrimaryKey = (
		identity?: PgIdentityOptions,
		options?: NumberOptions,
	) =>
		pgAttr(
			pgAttr(pgAttr(t.bigint(options), PG_PRIMARY_KEY), PG_IDENTITY, identity),
			PG_DEFAULT,
		);

	/**
	 * Creates a primary key with a UUID column.
	 */
	public readonly uuidPrimaryKey = () =>
		pgAttr(pgAttr(t.uuid(), PG_PRIMARY_KEY), PG_DEFAULT);

	/**
	 *
	 */
	public primaryKey(
		type: TString,
	): PgAttr<PgAttr<TString, PgPrimaryKey>, PgDefault>;
	public primaryKey(
		type: TInteger,
	): PgAttr<PgAttr<TInteger, PgPrimaryKey>, PgDefault>;
	public primaryKey(
		type: TNumber,
	): PgAttr<PgAttr<TNumber, PgPrimaryKey>, PgDefault>;
	public primaryKey(
		type: TSchema,
	): PgAttr<PgAttr<TSchema, PgPrimaryKey>, PgDefault> {
		if (TypeGuard.IsString(type) && type.format === "uuid") {
			return this.uuidPrimaryKey();
		} else if (TypeGuard.IsInteger(type)) {
			return this.identityPrimaryKey();
		} else if (
			TypeGuard.IsNumber(type) &&
			PRIMITIVE in type &&
			type[PRIMITIVE] === "bigint"
		) {
			return this.bigIdentityPrimaryKey();
		}
		throw new Error(`Unsupported type for primary key: ${type}`);
	}

	/**
	 * Wrap a schema with "default" attribute.
	 * This is used to set a default value for a column in the database.
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
	 * Creates a column version.
	 * This is used to track the version of a row in the database.
	 * You can use it for optimistic concurrency control.
	 */
	public readonly version = (options: IntegerOptions = {}) =>
		this.default(pgAttr(t.int(options), PG_VERSION), 0);

	/**
	 * Creates a column Created At. So just a datetime column with a default value of the current timestamp.
	 */
	public readonly createdAt = (options?: StringOptions) =>
		pgAttr(pgAttr(t.datetime(options), PG_CREATED_AT), PG_DEFAULT);

	/**
	 * Creates a column Updated At. Like createdAt, but it is updated on every update of the row.
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
	 * - pg.default will be optional
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

	/**
	 * @alias ref
	 */
	public references = this.ref;

	/**
	 * Creates a reference to another table or schema with a foreign key.
	 *
	 * @experimental
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
