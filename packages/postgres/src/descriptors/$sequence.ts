import { $inject, createDescriptor, Descriptor, KIND } from "@alepha/core";
import { sql } from "drizzle-orm";
import { PostgresProvider } from "../providers/drivers/PostgresProvider.ts";

export const $sequence = (
	options: SequenceDescriptorOptions = {},
): SequenceDescriptor => {
	return createDescriptor(SequenceDescriptor, options);
};

// ---------------------------------------------------------------------------------------------------------------------

export interface SequenceDescriptorOptions {
	name?: string;
	start?: number;
	increment?: number;
	min?: number;
	max?: number;
	cycle?: boolean;
}

// ---------------------------------------------------------------------------------------------------------------------

export class SequenceDescriptor extends Descriptor<SequenceDescriptorOptions> {
	protected readonly provider = $inject(PostgresProvider);
	protected created = false;

	public get name(): string {
		return this.options.name ?? this.config.propertyKey;
	}

	protected async create(): Promise<void> {
		if (this.created) {
			return;
		}

		const options = this.options;
		const query = sql`CREATE SEQUENCE IF NOT EXISTS ${sql.raw(this.provider.schema)}."${sql.raw(this.name)}" `;

		if (options.increment != null) {
			query.append(sql`INCREMENT BY ${sql.raw(String(options.increment))} `);
		}

		if (options.min != null) {
			query.append(sql`MINVALUE ${sql.raw(String(options.min))}`);
		}

		if (options.max != null) {
			query.append(sql`MAXVALUE ${sql.raw(String(options.max))}`);
		}

		if (options.start != null) {
			query.append(sql`START WITH ${sql.raw(String(options.start))}`);
		}

		if (options.cycle) {
			query.append(sql`CYCLE`);
		}

		await this.provider.execute(query);

		this.created = true;
	}

	public async next(): Promise<number> {
		await this.create();
		return this.provider
			.execute(
				sql`SELECT nextval('${sql.raw(this.provider.schema)}."${sql.raw(this.name)}"')`,
			)
			.then((rows) => Number(rows[0]?.nextval));
	}

	public async current(): Promise<number> {
		await this.create();
		return this.provider
			.execute(
				sql`SELECT last_value FROM ${sql.raw(this.provider.schema)}."${sql.raw(this.name)}"`,
			)
			.then((rows) => Number(rows[0]?.last_value));
	}
}

$sequence[KIND] = SequenceDescriptor;
