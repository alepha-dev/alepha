import { $inject, Alepha } from "@alepha/core";
import type { Static, TObject } from "@sinclair/typebox";
import type { SQLWrapper } from "drizzle-orm";
import type { PgDatabase } from "drizzle-orm/pg-core";

export type SQLLike = SQLWrapper | string;

export abstract class PostgresProvider {
	protected readonly alepha = $inject(Alepha);

	public abstract get db(): PgDatabase<any>;

	public abstract get schema(): string;

	public abstract get dialect(): string;

	public abstract execute<T extends TObject = any>(
		query: SQLLike,
		schema?: T,
	): Promise<Array<T extends TObject ? Static<T> : any>>;
}
