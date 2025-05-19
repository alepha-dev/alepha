import { NotImplementedError } from "@alepha/core";
import type { SQLWrapper } from "drizzle-orm";
import type { PgDatabase } from "drizzle-orm/pg-core";

export type SQLLike = SQLWrapper | string;

export class PostgresProvider {
	constructor() {
		throw new NotImplementedError(this.constructor.name);
	}

	/**
	 * Get the database instance
	 */
	public get db(): PgDatabase<any> {
		throw new NotImplementedError(this.constructor.name);
	}

	public get schema(): string {
		throw new NotImplementedError(this.constructor.name);
	}

	public get dialect(): string {
		throw new NotImplementedError(this.constructor.name);
	}

	public execute(query: SQLLike): Promise<any[]> {
		throw new NotImplementedError(this.constructor.name);
	}
}
