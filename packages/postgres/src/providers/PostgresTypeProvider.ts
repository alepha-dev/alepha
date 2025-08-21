import { TypeGuard, t } from "@alepha/core";
import { PRIMITIVE } from "@alepha/core/src/constants/PRIMITIVE.ts";
import type {
	IntegerOptions,
	NumberOptions,
	ObjectOptions,
	Static,
	StringOptions,
	TInteger,
	TNumber,
	TObject,
	TSchema,
	TString,
} from "@sinclair/typebox";
import type { UpdateDeleteAction } from "drizzle-orm/pg-core/foreign-keys";
import {
	PG_CREATED_AT,
	PG_DEFAULT,
	PG_DELETED_AT,
	PG_IDENTITY,
	PG_PRIMARY_KEY,
	PG_REF,
	PG_UPDATED_AT,
	PG_VERSION,
	type PgDefault,
	type PgIdentityOptions,
	type PgPrimaryKey,
	type PgRef,
} from "../constants/PG_SYMBOLS.ts";
import type { PgAttr } from "../helpers/pgAttr.ts";
import { pgAttr } from "../helpers/pgAttr.ts";
import type { TInsertObject } from "../interfaces/TInsertObject.ts";
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
	 * Creates a primary key for a given type. Supports:
	 * - `t.int()` -> PG INT (default)
	 * - `t.bigint()` -> PG BIGINT
	 * - `t.uuid()` -> PG UUID
	 */
	public primaryKey(): PgAttr<PgAttr<TInteger, PgPrimaryKey>, PgDefault>;
	public primaryKey(
		type: TString,
		options?: StringOptions,
	): PgAttr<PgAttr<TString, PgPrimaryKey>, PgDefault>;
	public primaryKey(
		type: TInteger,
		options?: IntegerOptions,
		identity?: PgIdentityOptions,
	): PgAttr<PgAttr<TInteger, PgPrimaryKey>, PgDefault>;
	public primaryKey(
		type: TNumber,
		options?: NumberOptions,
		identity?: PgIdentityOptions,
	): PgAttr<PgAttr<TNumber, PgPrimaryKey>, PgDefault>;
	public primaryKey(
		type?: TSchema,
		options?: IntegerOptions | NumberOptions | StringOptions,
		identity?: PgIdentityOptions,
	): PgAttr<PgAttr<TSchema, PgPrimaryKey>, PgDefault> {
		if (!type || TypeGuard.IsInteger(type)) {
			return pgAttr(
				pgAttr(pgAttr(t.int(options), PG_PRIMARY_KEY), PG_IDENTITY, identity),
				PG_DEFAULT,
			);
		} else if (TypeGuard.IsString(type) && type.format === "uuid") {
			return pgAttr(pgAttr(t.uuid(), PG_PRIMARY_KEY), PG_DEFAULT);
		} else if (
			TypeGuard.IsNumber(type) &&
			PRIMITIVE in type &&
			type[PRIMITIVE] === "bigint"
		) {
			return pgAttr(
				pgAttr(
					pgAttr(t.bigint(options), PG_PRIMARY_KEY),
					PG_IDENTITY,
					identity,
				),
				PG_DEFAULT,
			);
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
	 * Creates a column 'version'.
	 *
	 * This is used to track the version of a row in the database.
	 *
	 * You can use it for optimistic concurrency control (OCC) with {@link RepositoryDescriptor#save}.
	 *
	 * @see {@link RepositoryDescriptor#save}
	 * @see {@link PgVersionMismatchError}
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
	 * Creates a column Deleted At for soft delete functionality.
	 * This is used to mark rows as deleted without actually removing them from the database.
	 * The column is nullable - NULL means not deleted, timestamp means deleted.
	 */
	public readonly deletedAt = (options?: StringOptions) =>
		pgAttr(t.optional(t.datetime(options)), PG_DELETED_AT);

	/**
	 * Creates a reference to another table or schema. Basically a foreign key.
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

	// -------------------------------------------------------------------------------------------------------------------

	/**
	 * Convert a schema to a schema for INSERT operations.
	 * It means that:
	 * - All pg.default() will be optional
	 *
	 * @internal
	 */
	public readonly insert = <T extends TObject>(obj: T): TInsertObject<T> => {
		const properties: Record<string, TSchema> = {};
		const required: string[] = [];

		for (const key in obj.properties) {
			const prop = obj.properties[key];

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
	 * Creates a page schema for a given object schema.
	 * It's used by {@link RepositoryDescriptor#paginate} method.
	 */
	public readonly page = <T extends TObject>(
		resource: T,
		options?: ObjectOptions,
	): TPage<T> => {
		return pageSchema(resource, options);
	};
}

export const pg = new PostgresTypeProvider();
