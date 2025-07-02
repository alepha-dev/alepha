import type { OptionalKind, Static, TObject } from "@sinclair/typebox";
import type { PG_DEFAULT } from "../constants/PG_SYMBOLS.ts";

/**
 * Enhance Typebox with a support of "Default" (PG_DEFAULT).
 */
export type InferInsert<T extends TObject> = StaticEntry<T> &
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
