import { $hook, $inject, KIND } from "@alepha/core";
import { sql } from "drizzle-orm";
import type { SequenceDescriptor } from "../descriptors/$sequence.ts";
import { $sequence } from "../descriptors/$sequence.ts";
import { PostgresProvider } from "./drivers/PostgresProvider.ts";

export class SequenceProvider {
	protected readonly provider = $inject(PostgresProvider);
	protected readonly sequences: Sequence[] = [];

	protected readonly start = $hook({
		name: "start",
		handler: async (app) => {
			const sequences = app.getDescriptorValues($sequence);
			for (const { value, instance, key } of sequences) {
				const options = value.options;
				const name = options.name ?? key;
				await this.create(name, options);

				const $: SequenceDescriptor = () => this.next(name);

				$[KIND] = value[KIND];
				$.options = options;
				$.next = () => this.next(name);
				$.current = () => this.current(name);

				instance[key] = $;
			}
		},
	});

	public async create(
		name: string,
		options: CreateSequence,
	): Promise<Sequence> {
		const sequence = this.sequences.find((sequence) => sequence.name === name);
		if (sequence?.created) {
			return sequence;
		}

		const provider = this.provider;
		const seq = {
			provider,
			name,
			options,
		};

		const query = sql`CREATE SEQUENCE IF NOT EXISTS ${sql.raw(seq.provider.schema)}."${sql.raw(seq.name)}" `;

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

		await provider.execute(query);

		this.sequences.push(seq);

		return seq;
	}

	public async next(name: string | Sequence): Promise<number> {
		const seq = await this.seq(name);
		return seq.provider
			.execute(
				sql`SELECT nextval('${sql.raw(seq.provider.schema)}."${sql.raw(seq.name)}"')`,
			)
			.then((rows) => Number(rows[0]?.nextval));
	}

	public async current(name: string | Sequence): Promise<number> {
		const seq = await this.seq(name);
		return seq.provider
			.execute(
				sql`SELECT last_value FROM ${sql.raw(seq.provider.schema)}."${sql.raw(seq.name)}"`,
			)
			.then((rows) => Number(rows[0]?.last_value));
	}

	protected async seq(name: string | Sequence): Promise<Sequence> {
		const seqName = typeof name === "string" ? name : name.name;
		const sequence = this.sequences.find(
			(sequence) => sequence.name === seqName,
		);
		if (sequence) {
			return sequence;
		}

		return await this.create(seqName, {});
	}
}

export interface Sequence {
	provider: PostgresProvider;
	name: string;
	options: CreateSequence;
	created?: boolean;
}

export interface CreateSequence {
	start?: number;
	increment?: number;
	min?: number;
	max?: number;
	cycle?: boolean;
}
