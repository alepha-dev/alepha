/**
 * Converts null values to undefined.
 */
export const nullToUndefined = (schema: any, value: any): any => {
	if (!schema) {
		return value;
	}
	if (value == null && !isSchemaNullable(schema)) {
		return undefined;
	}
	if (Array.isArray(value)) {
		return value.map((it) => nullToUndefined(schema.items, it));
	}
	if (typeof value === "object" && value !== null) {
		const obj: any = {};
		for (const key in value) {
			const r = nullToUndefined(schema.properties?.[key], value[key]);
			if (r !== undefined) obj[key] = r;
		}
		return obj;
	}
	return value;
};

const isSchemaNullable = (schema: any): boolean => {
	if (!schema) return false;
	if (schema.type === "null") return true;
	if (Array.isArray(schema.type) && schema.type.includes("null")) return true;
	if (schema.anyOf) {
		return schema.anyOf.some((it: any) => isSchemaNullable(it));
	}
	if (schema.oneOf) {
		return schema.oneOf.some((it: any) => isSchemaNullable(it));
	}
	if (schema.allOf) {
		return schema.allOf.some((it: any) => isSchemaNullable(it));
	}
	return false;
};
