import { $inject, $logger, Alepha } from "@alepha/core";
import type { TObject } from "@sinclair/typebox";
import type { TableConfig } from "drizzle-orm/pg-core";
import {
	$repository,
	type RepositoryDescriptor,
} from "../descriptors/$repository.ts";
import type { PostgresProvider } from "./drivers/PostgresProvider.ts";

export class RepositoryDescriptorProvider {
	protected readonly log = $logger();
	protected readonly alepha = $inject(Alepha);

	public get repositories(): RepositoryDescriptor<TableConfig, TObject>[] {
		const list: RepositoryDescriptor<TableConfig, TObject>[] = [];
		for (const descriptor of this.alepha.descriptors($repository)) {
			if (!list.find((it) => it.table === descriptor.table)) {
				list.push(descriptor);
			}
		}
		return list;
	}

	constructor() {
		// TODO: it's time to remove it and use it manually in tests

		// during testing only,
		if (this.alepha.isTest()) {
			const afterEach = this.alepha.state("afterEach");
			// when afterEach hook is available
			if (afterEach) {
				// -> clear all repositories after each test
				afterEach(() => {
					return this.clearRepositories();
				});
			}
		}
	}

	public async clearRepositories() {
		await Promise.all(this.repositories.map((it) => it.clear()));
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
	 * Get all providers from the repositories.
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
