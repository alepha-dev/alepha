import type {
	ArrayOptions,
	IntegerOptions,
	NumberOptions,
	ObjectOptions,
	SchemaOptions,
	StringOptions,
	TArray,
	TBoolean,
	TInteger,
	TIntersect,
	TNull,
	TNumber,
	TObject,
	TOptionalWithFlag,
	TProperties,
	TSchema,
	TString,
	Union,
	UnsafeOptions,
} from "@sinclair/typebox";
import { FormatRegistry, Kind, Type } from "@sinclair/typebox";

import * as TypeBox from "@sinclair/typebox";
import * as TypeBoxValue from "@sinclair/typebox/value";

export { TypeBox, TypeBoxValue };

import { Value } from "@sinclair/typebox/value";
import { PRIMITIVE } from "../constants/PRIMITIVE";
import { fullFormats } from "../helpers/formats";

export { TypeGuard } from "@sinclair/typebox";
export type {
	Static,
	StaticDecode,
	StaticEncode,
	TObject,
	TSchema,
} from "@sinclair/typebox";

export class TypeProvider {
	static DEFAULT_STRING_MAX_LENGTH = 255;
	static DEFAULT_LONG_STRING_MAX_LENGTH = 1024;
	static DEFAULT_RICH_STRING_MAX_LENGTH = 16384;
	static DEFAULT_ARRAY_MAX_ITEMS = 100;
	static FormatRegistry = FormatRegistry;

	public Type = Type;

	public any = Type.Any;

	public void = Type.Void;

	public undefined = Type.Undefined;

	public record = Type.Record;

	public omit = Type.Omit;

	public union = Type.Union;

	public partial = Type.Partial;

	public composite = Type.Composite;

	public pick = Type.Pick;

	public clean = Value.Clean;

	/**
	 * Create a schema for an object.
	 *
	 * @param properties The properties of the object.
	 * @param options The options for the object.
	 */
	public object = <T extends TProperties>(
		properties: T,
		options?: ObjectOptions,
	): TObject<T> =>
		Type.Object(properties, {
			additionalProperties: false,
			...options,
		});

	/**
	 * Create a schema for an array.
	 *
	 * @param schema
	 * @param options
	 */
	public array = <T extends TSchema>(
		schema: T,
		options?: ArrayOptions,
	): TArray<T> =>
		Type.Array(schema, {
			maxItems: TypeProvider.DEFAULT_ARRAY_MAX_ITEMS,
			...options,
		});

	/**
	 * Create a schema for a string.
	 *
	 * @param options
	 */
	public string = (options?: AlephaStringOptions): TString => {
		const size = options?.size;
		const maxLength =
			size === "long"
				? TypeProvider.DEFAULT_LONG_STRING_MAX_LENGTH
				: size === "rich"
					? TypeProvider.DEFAULT_RICH_STRING_MAX_LENGTH
					: TypeProvider.DEFAULT_STRING_MAX_LENGTH;

		delete options?.size;

		return Type.String({
			[PRIMITIVE]: "string",
			maxLength,
			...options,
		});
	};

	/**
	 * Create a schema for a JSON object.
	 *
	 * @param options
	 */
	public json = (options?: SchemaOptions) =>
		t.record(t.string(), t.any(), options);

	/**
	 * Create a schema for a boolean.
	 *
	 * @param options
	 */
	public boolean = (options?: SchemaOptions): TBoolean =>
		Type.Boolean({
			[PRIMITIVE]: "bool",
			...options,
		});

	/**
	 * Create a schema for a number.
	 *
	 * @param options
	 */
	public number = (options?: NumberOptions): TNumber =>
		Type.Number({
			[PRIMITIVE]: "float",
			...options,
		});

	/**
	 * Create a schema for an unsigned 8-bit integer.
	 *
	 * @param options
	 */
	public uchar = (options?: IntegerOptions): TInteger =>
		Type.Integer({
			[PRIMITIVE]: "uchar",
			minimum: 0,
			maximum: 255,
			...options,
		});

	/**
	 * Create a schema for an unsigned 32-bit integer.
	 *
	 * @param options
	 */
	public uint = (options?: IntegerOptions): TNumber =>
		Type.Number({
			[PRIMITIVE]: "uint32",
			multipleOf: 1,
			minimum: 0,
			maximum: 4294967296,
			...options,
		});

	/**
	 * Create a schema for a signed 32-bit integer.
	 *
	 * @param options
	 */
	public int = (options?: IntegerOptions): TInteger =>
		Type.Integer({
			[PRIMITIVE]: "int32",
			minimum: -2147483647,
			maximum: 2147483647,
			...options,
		});

	/**
	 * Make a schema optional.
	 *
	 * @param schema The schema to make optional.
	 */
	public optional = <T extends TSchema>(
		schema: T,
	): TOptionalWithFlag<T, true> => Type.Optional(schema);

	/**
	 * Nullify all properties of a schema.
	 *
	 * @param schema The schema to nullify.
	 * @param options The options for the schema.
	 */
	public nullify = <T extends TSchema>(schema: T, options?: ObjectOptions) =>
		Type.Mapped(
			Type.KeyOf(schema),
			(K) => this.nullable(Type.Index(schema, K), options),
			options,
		);

	/**
	 * Make a schema nullable.
	 *
	 * @param schema The schema to make nullable.
	 * @param options The options for the schema.
	 */
	public nullable = <T extends TSchema>(
		schema: T,
		options?: ObjectOptions,
	): Union<[TNull, T]> => Type.Union([Type.Null(), schema], options);

	/**
	 * Map a schema to another schema.
	 *
	 * @param schema The schema to map.
	 * @param operations The operations to perform on the schema.
	 * @param options The options for the schema.
	 * @returns The mapped schema.
	 */
	public map = <
		T extends TObject | TIntersect,
		Omit extends (keyof T["properties"])[],
		Optional extends (keyof T["properties"])[],
	>(
		schema: T,
		operations: {
			omit: readonly [...Omit];
			optional: [...Optional];
		},
		options?: ObjectOptions,
	) => {
		const omit: readonly [...Omit] = operations.omit;
		const optional: [...Optional] = operations.optional;
		return Type.Composite(
			[
				Type.Omit(schema, [...omit, ...optional]),
				Type.Partial(Type.Pick(schema, optional)),
			],
			options,
		);
	};

	/**
	 * Create a schema for a string enum.
	 *
	 * @param values
	 * @param options
	 */
	public enum = <T extends string[]>(values: [...T], options?: StringOptions) =>
		this.Type.Unsafe<T[number]>({
			[PRIMITIVE]: "string",
			[Kind]: "String",
			type: "string",
			enum: values,
			pattern: values.map((v) => `^${v}$`).join("|"),
			...options,
		});

	/**
	 * Create a schema for a string enum e.g. LIKE_THIS.
	 *
	 * @param options
	 */
	public snakeCase = (options?: StringOptions) =>
		this.string({
			pattern: "^[A-Z_-]+$",
			...options,
		});

	/**
	 * Create a schema for an object with a value and label.
	 *
	 * @param options
	 */
	public valueLabel = (options?: ObjectOptions) =>
		this.object(
			{
				value: this.snakeCase({
					description: "Machine-readable value.",
				}),
				label: this.string({
					description: "Human-readable label.",
				}),
				description: this.optional(
					this.string({
						description: "Description of the value.",
						maxLength: 1024,
					}),
				),
			},
			options,
		);

	/**
	 * Create a schema for a datetime.
	 *
	 * @param options The options for the date.
	 */
	public datetime = (options?: StringOptions): TString =>
		this.string({
			...options,
			format: "date-time",
		});

	/**
	 * Create a schema for a date.
	 *
	 * @param options
	 */
	public date = (options?: StringOptions): TString =>
		this.string({
			...options,
			format: "date",
		});

	/**
	 * Create a schema for uuid.
	 *
	 * @param options The options for the duration.
	 */
	public uuid = (options?: StringOptions): TString =>
		this.string({
			...options,
			format: "uuid",
		});

	/**
	 *
	 *
	 * @param kind
	 * @param options
	 */
	public unsafe = <T>(kind: string, options: UnsafeOptions = {}) =>
		Type.Unsafe<T>({
			[Kind]: kind,
			...options,
		});
}

export const t = new TypeProvider();

export type TextLength = "short" | "long" | "rich";

export interface AlephaStringOptions extends StringOptions {
	size?: TextLength;
}

for (const [formatName, formatValue] of Object.entries(fullFormats)) {
	if (!FormatRegistry.Has(formatName)) {
		if (formatValue instanceof RegExp)
			FormatRegistry.Set(formatName, (value) =>
				value != null ? formatValue.test(value) : true,
			);
		else if (typeof formatValue === "function")
			FormatRegistry.Set(formatName, formatValue);
	}
}

export const isUUID = (value: string): boolean => {
	return fullFormats.uuid.test(value);
};
