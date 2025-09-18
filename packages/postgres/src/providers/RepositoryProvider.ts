import type { TObject } from "@alepha/core";
import { $inject, Alepha } from "@alepha/core";
import { $logger } from "@alepha/logger";
import type { TableConfig } from "drizzle-orm/pg-core";
import {
	$repository,
	type RepositoryDescriptor,
} from "../descriptors/$repository.ts";
import type { PostgresProvider } from "./drivers/PostgresProvider.ts";

export class RepositoryProvider {
	protected readonly log = $logger();
	protected readonly alepha = $inject(Alepha);

	protected get repositories(): RepositoryDescriptor<TableConfig, TObject>[] {
		const list: RepositoryDescriptor<TableConfig, TObject>[] = [];

		for (const descriptor of this.alepha.descriptors($repository)) {
			if (!list.find((it) => it.table === descriptor.table)) {
				list.push(descriptor);
			}
		}

		return list;
	}

	/**
	 * Get all repositories.
	 *
	 * @param provider - Filter by provider.
	 */
	public getRepositories(
		provider?: PostgresProvider,
	): RepositoryDescriptor<TableConfig, TObject>[] {
		if (provider) {
			return this.repositories.filter(
				(repository) => repository.provider === provider,
			);
		}

		return this.repositories;
	}

	/**
	 * Get all tables from the repositories.
	 *
	 * @param provider
	 */
	public getTables(provider?: PostgresProvider) {
		return this.getRepositories(provider).map((it) => it.table);
	}

	/**
	 * Get all pg providers from the repositories.
	 */
	public getProviders(): PostgresProvider[] {
		const providers: PostgresProvider[] = [];

		for (const repository of this.repositories) {
			if (!providers.includes(repository.provider)) {
				providers.push(repository.provider);
			}
		}

		return providers;
	}
}
