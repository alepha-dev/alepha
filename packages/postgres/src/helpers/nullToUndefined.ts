/**
 * Replaces all null values in an object with undefined.
 *
 * @param value - The object to be processed.
 * @return A new object with all null values replaced with undefined.
 */
export const nullToUndefined = <T extends object>(
	value: T,
): NullToUndefined<T> => {
	const obj: Record<string, any> = {};

	if (typeof value === "object") {
		if (Array.isArray(value)) {
			return value.map((item) => nullToUndefined(item)) as NullToUndefined<T>;
		}
		for (const key in value) {
			if (value[key] != null) {
				obj[key] = value[key];
			}
		}
	}

	return obj as NullToUndefined<T>;
};

// ---------------------------------------------------------------------------------------------------------------------

/**
 * Replaces all null values in an object with undefined.
 */
export type NullToUndefined<T> = T extends null
	? undefined
	: T extends
				| null
				| undefined
				| string
				| number
				| boolean
				| symbol
				| bigint
				// eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
				| Function
				| Date
				| RegExp
		? T
		: T extends Array<infer U>
			? Array<NullToUndefined<U>>
			: T extends Map<infer K, infer V>
				? Map<K, NullToUndefined<V>>
				: T extends Set<infer U>
					? Set<NullToUndefined<U>>
					: T extends object
						? { [K in keyof T]: NullToUndefined<T[K]> }
						: unknown;

export type NullifyIfOptional<T> = {
	[K in keyof T]: undefined extends T[K] ? T[K] | null : T[K];
};
