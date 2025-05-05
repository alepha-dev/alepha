import type { TObject, TSchema } from "@sinclair/typebox";
import { eq, getTableName } from "drizzle-orm";
import type { PgColumn, PgSelectJoinFn } from "drizzle-orm/pg-core";
import type { PgManyOptions } from "../constants/PG_SYMBOLS.ts";
import { PG_MANY, PG_PRIMARY_KEY } from "../constants/PG_SYMBOLS.ts";
import type { PgQuery, PgQueryWith } from "../interfaces/PgQuery.ts";
import type { PgAttrField } from "../services/Repository.ts";

/*

     Collection of functions to handle One-One, One-Many and Many-Many relations

 */

/**
 * Aggregates rows by id
 *
 * @param rows
 * @param pgManyFields
 * @param query
 * @param tableName
 * @param idKey
 */
export const aggregateRowsByRelation = (
	rows: any[],
	pgManyFields: PgManyField[],
	query: PgQuery<any>,
	tableName: string,
	idKey: string,
) => {
	const newRows: any[] = [];

	for (const row of rows) {
		const root = row[tableName];
		if (!root) continue;

		const exists = newRows.find((it) => it[idKey] === root[idKey]);
		if (!exists) newRows.push(root);

		const target = exists ?? root;

		// for each relation on the table
		for (const relation of pgManyFields) {
			const withQuery = query.relations?.[relation.key];
			if (withQuery) {
				parseRelation(row, target, relation, withQuery);
			}
		}
	}

	return newRows;
};

const parseRelation = (
	row: any,
	root: any,
	relation: PgManyField,
	pgQuery: PgQueryWith<any>,
) => {
	const virtualKey = relation.key; // user.posts
	const relationTable = relation.data.table; // Drizzle "posts"
	const relationTableName = getTableName(relationTable); // Drizzle "posts" as string
	const relationSchema = relation.data.schema; // TypeBox "posts"
	const relationIdKey = getPrimaryKey(relationSchema); // "id"

	const object = row[relationTableName];
	if (!object) {
		return;
	}

	if (!root[virtualKey]) {
		root[virtualKey] = [];
	}

	const exists = root[virtualKey].find(
		(it: any) => it[relationIdKey] === object[relationIdKey],
	);

	if (!exists) {
		root[virtualKey].push(object);
	}

	const target = exists ?? object;

	if (relation.nested) {
		for (const nestedRelation of relation.nested) {
			if (
				typeof pgQuery === "object" &&
				pgQuery.relations?.[nestedRelation.key]
			) {
				parseRelation(
					row,
					target,
					nestedRelation,
					pgQuery.relations[nestedRelation.key],
				);
			}
		}
	}
};

export const prefillJoins = (
	builder: { leftJoin: PgSelectJoinFn<any, any, "left", true> },
	query: PgQuery<any>,
	schema: TObject,
	id: PgColumn,
) => {
	const pgManyFields = getManyRelations(schema);

	for (const pgManyField of pgManyFields) {
		const withQuery = query.relations?.[pgManyField.key];
		if (withQuery) {
			const fk = pgManyField.data.foreignKey;
			const table = pgManyField.data.table as any;

			builder.leftJoin(table, eq(id, table[fk]));

			const fields = getManyRelations(pgManyField.data.schema);
			const isNested = typeof withQuery === "object";

			if (fields && isNested) {
				const pk = getPrimaryKey(pgManyField.data.schema);
				pgManyField.nested = prefillJoins(
					builder,
					withQuery,
					pgManyField.data.schema,
					table[pk],
				);
			}
		}
	}

	return pgManyFields;
};

const getPrimaryKey = (schema: TObject) => {
	for (const key of Object.keys(schema.properties)) {
		const value = schema.properties[key];
		if (PG_PRIMARY_KEY in value) {
			return key;
		}
	}
	throw new Error("Primary key not found in schema");
};

const getManyRelations = (schema: TObject): PgManyField[] => {
	const fields: Array<PgManyField> = [];

	for (const key of Object.keys(schema.properties)) {
		const value = schema.properties[key];
		if (PG_MANY in value) {
			fields.push({
				type: value as TSchema,
				key: key,
				data: (value as any)[PG_MANY],
			});
		}
	}

	return fields;
};

export interface PgManyField {
	key: string;
	type: TSchema;
	data: PgManyOptions; // table, schema, foreignKey
	nested?: PgAttrField[];
}
