import { $hook, $inject, $logger, Alepha, OPTIONS } from "@alepha/core";
import type { TObject } from "@sinclair/typebox";
import type { PgTableWithColumns, TableConfig } from "drizzle-orm/pg-core";
import { PG_SCHEMA } from "../constants/PG_SCHEMA.ts";
import type { RepositoryDescriptorOptions } from "../descriptors/$repository.ts";
import { $repository } from "../descriptors/$repository.ts";
import { Repository } from "../services/Repository.ts";
import { PostgresProvider } from "./drivers/PostgresProvider.ts";

export class RepositoryDescriptorProvider {
	protected readonly log = $logger();
	protected readonly alepha = $inject(Alepha);
	protected readonly repositories: Array<Repository<any, TObject>> = [];

	constructor() {
		// during testing only,
		if (this.alepha.isTest()) {
			const afterEach = this.alepha.state("afterEach");
			// when afterEach hook is available
			if (afterEach) {
				// -> clear all repositories after each test
				afterEach(() => {
					return Promise.all(this.repositories.map((it) => it.clear()));
				});
			}
		}
	}

	protected readonly configure = $hook({
		name: "configure",
		handler: async () => {
			await this.processDescriptors();
		},
	});

	/**
	 * Get all repositories.
	 *
	 * @param provider - Filter by provider.
	 */
	public getRepositories(
		provider?: PostgresProvider,
	): Repository<PgTableWithColumns<TableConfig>, TObject>[] {
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

	/**
	 * Process all descriptors.
	 *
	 * @protected
	 */
	protected async processDescriptors() {
		await this.processRepositoryDescriptors();
	}

	/**
	 * Get all models from the repository descriptors.
	 *
	 * By models, we mean the tables.
	 */
	protected async processRepositoryDescriptors() {
		const repositories = this.alepha.getDescriptorValues($repository);

		for (const { value, instance, key } of repositories) {
			const options = value[OPTIONS] as RepositoryDescriptorOptions<
				TableConfig,
				TObject
			>;

			const provider = options.provider
				? options.provider()
				: this.alepha.get(PostgresProvider);

			const alreadyExists = this.repositories.find(
				(it) => it.table === options.table && it.provider === provider,
			);

			if (alreadyExists) {
				instance[key] = alreadyExists;
				continue;
			}

			const table = options.table;
			const schema = table[PG_SCHEMA];

			const repository = this.alepha.get(Repository, {
				skipRegistration: true,
				args: [
					{
						provider,
						table,
						schema,
					},
				],
			});

			// first time we use class instance as descriptor value
			instance[key] = repository;

			this.repositories.push(repository);
		}
	}
}
