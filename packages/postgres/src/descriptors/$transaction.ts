import { $cursor } from "@alepha/core";
import { $retry } from "@alepha/retry";
import type { PgTransaction } from "drizzle-orm/pg-core";
import type { PgTransactionConfig } from "drizzle-orm/pg-core/session";
import { PgVersionMismatchError } from "../errors/PgVersionMismatchError.ts";
import { PostgresProvider } from "../providers/drivers/PostgresProvider.ts";

/**
 * @stability 2
 */
export const $transaction = <T extends any[], R>(
	opts: TransactionDescriptorOptions<T, R>,
) => {
	const { context } = $cursor();
	const provider = context.inject(PostgresProvider);

	return $retry({
		when: (err) => err instanceof PgVersionMismatchError,
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
