import { t } from "@alepha/core";
import {
	type Evaluate,
	Kind,
	type ObjectOptions,
	OptionalKind,
	type Static,
	type TAdditionalProperties,
	type TObject,
	type TOptional,
	type TProperties,
	type TReadonly,
	type TSchema,
} from "@sinclair/typebox";
import { PG_DEFAULT } from "../constants/PG_SYMBOLS.ts";

/**
 * Fork of the original typebox schema "TObject".
 */
export interface TObjectInsert<T extends TObject>
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

export const insertSchema = <T extends TObject>(obj: T): TObjectInsert<T> => {
	const properties: Record<string, TSchema> = {};
	const required: string[] = [];

	for (const key in obj.properties) {
		const prop = obj.properties[key];

		if (PG_DEFAULT in prop) {
			properties[key] = t.optional(prop);
		} else {
			properties[key] = prop;
			if (obj.required?.includes(key)) {
				required.push(key);
			}
		}
	}

	return {
		...obj,
		required,
		properties,
	} as unknown as TObjectInsert<T>;
};

/**
 * Enhance Typebox with a support of "Default" (PG_DEFAULT).
 */
export type StaticInsert<T extends TObject> = StaticEntry<T> &
	StaticDefaultEntry<T>;

export type StaticDefaultEntry<T extends TObject> = {
	[K in keyof T["properties"] as T["properties"][K] extends
		| {
				[PG_DEFAULT]: any;
		  }
		| {
				[OptionalKind]: "Optional";
		  }
		? K
		: never]?: Static<T["properties"][K]>;
};

export type StaticEntry<T extends TObject> = {
	[K in keyof T["properties"] as T["properties"][K] extends
		| {
				[PG_DEFAULT]: any;
		  }
		| { [OptionalKind]: "Optional" }
		? never
		: K]: Static<T["properties"][K]>;
};
