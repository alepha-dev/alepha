import { t } from "@alepha/core";
import type {
	ObjectOptions,
	TArray,
	TBoolean,
	TInteger,
	TIntersect,
	TObject,
	TOptionalWithFlag,
	TRecord,
} from "@sinclair/typebox";

/**
 * Page Schema
 *
 * @param objectSchema
 * @param options
 */
export const pageSchema = <T extends TObject | TIntersect | TRecord>(
	objectSchema: T,
	options?: ObjectOptions,
): TPage<T> =>
	t.object(
		{
			content: t.array(objectSchema),
			can: t.object({
				next: t.boolean(),
				previous: t.boolean(),
			}),
			page: t.object({
				number: t.int(),
				size: t.int(),
				totalElements: t.optional(t.int()),
				queryDuration: t.optional(t.int()),
				countDuration: t.optional(t.int()),
			}),
		},
		{
			title: objectSchema.title ? `${objectSchema.title}Page` : undefined,
			...options,
		},
	);

export type TPage<T extends TObject | TIntersect | TRecord> = TObject<{
	content: TArray<T>;
	can: TObject<{ next: TBoolean; previous: TBoolean }>;
	page: TObject<{
		number: TInteger;
		size: TInteger;
		totalElements: TOptionalWithFlag<TInteger, true>;
		queryDuration: TOptionalWithFlag<TInteger, true>;
		countDuration: TOptionalWithFlag<TInteger, true>;
	}>;
}>;

export type Page<T> = {
	content: T[];
	can: { next: boolean; previous: boolean };
	page: {
		number: number;
		size: number;
		totalElements?: number;
		queryDuration?: number;
		countDuration?: number;
	};
};
