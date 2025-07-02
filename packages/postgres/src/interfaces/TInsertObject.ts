import type {
	Evaluate,
	Kind,
	ObjectOptions,
	Static,
	TAdditionalProperties,
	TObject,
	TOptional,
	TProperties,
	TReadonly,
	TSchema,
} from "@sinclair/typebox";
import type { PG_DEFAULT } from "../constants/PG_SYMBOLS.ts";

/**
 * Fork of the original typebox schema "TObject".
 */
export interface TInsertObject<T extends TObject>
	extends TSchema,
		ObjectOptions {
	[Kind]: "Object";
	static: ObjectStatic<
		{
			[K in keyof T["properties"] as T["properties"][K] extends {
				[PG_DEFAULT]: any;
			}
				? never
				: K]: T["properties"][K];
		},
		this["params"]
	>;
	additionalProperties?: TAdditionalProperties;
	type: "object";
	required?: string[];
	//
	properties: {
		[K in keyof T["properties"] as T["properties"][K] extends {
			[PG_DEFAULT]: any;
		}
			? never
			: K]: T["properties"][K];
	};
}

type ReadonlyOptionalPropertyKeys<T extends TProperties> = {
	[K in keyof T]: T[K] extends TReadonly<TSchema>
		? T[K] extends TOptional<T[K]>
			? K
			: never
		: never;
}[keyof T];

type ReadonlyPropertyKeys<T extends TProperties> = {
	[K in keyof T]: T[K] extends TReadonly<TSchema>
		? T[K] extends TOptional<T[K]>
			? never
			: K
		: never;
}[keyof T];

type OptionalPropertyKeys<T extends TProperties> = {
	[K in keyof T]: T[K] extends TOptional<TSchema>
		? T[K] extends TReadonly<T[K]>
			? never
			: K
		: never;
}[keyof T];

type RequiredPropertyKeys<T extends TProperties> = keyof Omit<
	T,
	| ReadonlyOptionalPropertyKeys<T>
	| ReadonlyPropertyKeys<T>
	| OptionalPropertyKeys<T>
>;

type ObjectStaticProperties<
	T extends TProperties,
	R extends Record<keyof any, unknown>,
> = Evaluate<
	Readonly<Partial<Pick<R, ReadonlyOptionalPropertyKeys<T>>>> &
		Readonly<Pick<R, ReadonlyPropertyKeys<T>>> &
		Partial<Pick<R, OptionalPropertyKeys<T>>> &
		Required<Pick<R, RequiredPropertyKeys<T>>>
>;

type ObjectStatic<
	T extends TProperties,
	P extends unknown[],
> = ObjectStaticProperties<
	T,
	{
		[K in keyof T]: Static<T[K], P>;
	}
>;
