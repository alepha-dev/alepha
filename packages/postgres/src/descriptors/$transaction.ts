import { $cursor } from "@alepha/core";
import { $retry } from "@alepha/retry";
import type { PgTransaction } from "drizzle-orm/pg-core";
import type { PgTransactionConfig } from "drizzle-orm/pg-core/session";
import { VersionMismatchError } from "../errors/VersionMismatchError.ts";
import { PostgresProvider } from "../providers/drivers/PostgresProvider.ts";

/**
 *
 */
export const $transaction = <T extends any[], R>(
	opts: TransactionDescriptorOptions<T, R>,
) => {
	const { context } = $cursor();
	const provider = context.get(PostgresProvider);

	return $retry({
		when: (err) => err instanceof VersionMismatchError,
		handler: (...args: T) =>
			provider.db.transaction(
				async (tx) => opts.handler(tx, ...args),
				opts.config,
			),
	});
};

// ---------------------------------------------------------------------------------------------------------------------

export interface TransactionDescriptorOptions<T extends any[], R> {
	handler: (tx: PgTransaction<any, any, any>, ...args: T) => Promise<R>;
	config?: PgTransactionConfig;
}

export type TransactionContext = PgTransaction<any, any, any>;
