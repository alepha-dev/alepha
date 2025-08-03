import {
	type Static,
	type TObject,
	type TSchema,
	TypeBoxError,
	TypeGuard,
} from "@alepha/core";
import { useAlepha } from "@alepha/react";
import type { InputHTMLAttributes } from "react";

/**
 * Custom hook to create a form with validation and field management.
 * This hook uses TypeBox schemas to define the structure and validation rules for the form.
 * It provides a way to handle form submission, field creation, and value management.
 *
 * @example
 * ```tsx
 * import { t } from "@alepha/core";
 *
 * const form = useForm({
 *   schema: t.object({
 *     username: t.string(),
 *     password: t.string(),
 *   }),
 *   handler: (values) => {
 *     console.log("Form submitted with values:", values);
 *   },
 * });
 *
 * return (
 *   <form onSubmit={form.onSubmit}>
 *     <input {...form.input("username")} />
 *     <input {...form.input("password")} />
 *     <button type="submit">Submit</button>
 *   </form>
 * );
 * ```
 */
export const useForm = <T extends TObject>(
	options: UseFormOptions<T>,
): UseFormReturn<T> => {
	const alepha = useAlepha();

	return {
		input: createProxyFromSchema(options, options.schema, {
			parent: "",
		}),
		onSubmit: (event: FormEventLike) => {
			event.preventDefault();

			const form = event.currentTarget;
			const values: Record<string, any> = parseValuesFromFormElement(
				options,
				form,
			);
			const args = {
				form,
			};

			try {
				if (TypeGuard.IsSchema(options.schema)) {
					options.handler(alepha.parse(options.schema, values), args);
				} else {
					options.handler(values, args); // for now, trust
				}
			} catch (error) {
				if (error instanceof TypeBoxError) {
					if (options.onError) {
						options.onError?.(error, args);
					}
					return;
				}
				throw error;
			}
		},
	};
};

const parseValuesFromFormElement = <T extends TObject>(
	options: UseFormOptions<T>,
	form: HTMLFormElement,
): Record<string, any> => {
	const formData = new FormData(form);
	const values: Record<string, any> = {};

	for (const [key, value] of formData.entries()) {
		if (key.includes(".")) {
			// addon: support for nested objects
			getValueFromInputObject(options, values, key, value);
		} else if (options.schema?.properties[key] != null) {
			values[key] = getValueFromInput(value, options.schema.properties[key]);
		}
	}

	return values;
};

const getValueFromInputObject = <T extends TObject>(
	options: UseFormOptions<T>,
	values: Record<string, any>,
	key: string,
	value: FormDataEntryValue,
) => {
	const pathSegments = key.split(".");
	const finalPropertyKey = pathSegments.pop();
	if (!finalPropertyKey) {
		return;
	}

	let currentObjectLevel = values;
	let currentSchemaLevel: TSchema | undefined = options.schema;

	// traverse the path to find the target object and its schema.
	for (const segment of pathSegments) {
		currentObjectLevel[segment] ??= {};
		currentObjectLevel = currentObjectLevel[segment];

		if (
			currentSchemaLevel?.type === "object" &&
			currentSchemaLevel.properties[segment]
		) {
			currentSchemaLevel = currentSchemaLevel.properties[segment];
		} else {
			// the path doesn't exist in the schema, so we can't validate or type it, abort!
			currentSchemaLevel = undefined;
			break;
		}
	}

	// find the schema for the final property.
	const finalPropertySchema =
		currentSchemaLevel && currentSchemaLevel.type === "object"
			? currentSchemaLevel.properties[finalPropertyKey]
			: undefined;

	if (finalPropertySchema) {
		currentObjectLevel[finalPropertyKey] = getValueFromInput(
			value,
			finalPropertySchema,
		);
	}
};

const createProxyFromSchema = <T extends TObject>(
	options: UseFormOptions<T>,
	schema: TSchema,
	context: {
		parent: string;
	},
): SchemaToInput<T> => {
	const parent = context.parent || "";
	return new Proxy<SchemaToInput<T>>({} as SchemaToInput<T>, {
		get: (_, prop: string) => {
			if (!options.schema) {
				return {};
			}
			if (prop in schema.properties) {
				if (schema.properties[prop].type === "object") {
					return createProxyFromSchema(options, schema.properties[prop], {
						parent: parent ? `${parent}.${prop}` : prop,
					});
				}
				return createInputFromSchema<T>(
					prop as keyof Static<T> & string,
					options,
					schema,
					context,
				);
			}
		},
	});
};

const createInputFromSchema = <T extends TObject>(
	name: keyof Static<T> & string,
	options: UseFormOptions<T>,
	schema: TSchema,
	context: {
		parent: string;
	},
): InputField => {
	const parent = context.parent || "";
	const field = schema.properties?.[name];
	if (!field) {
		return {
			path: "",
			props: {} as InputHTMLAttributes<unknown>,
			schema: schema,
		};
	}

	const isRequired = schema.required?.includes(name) ?? false;

	const key = parent ? `${parent}.${name}` : name;
	const path = `/${key.replaceAll(".", "/")}`;

	const attr: InputHTMLAttributesLike = {
		name: key,
		onChange: (event: React.ChangeEvent<HTMLInputElement>) => {
			const value = event.target.value;
			// Handle field change logic here if needed
			if (options.onChange) {
				options.onChange(path, getValueFromInput(value, field));
			}
		},
	};

	if (options.id) {
		attr.id = `${options.id}-${key}`;
		(attr as any)["data-testid"] = attr.id;
	}

	if (field.maxLength != null) {
		attr.maxLength = Number(field.maxLength);
	}

	if (field.minLength != null) {
		attr.minLength = Number(field.minLength);
	}

	if (options.initialValues?.[name] != null) {
		attr.defaultValue = valueToInputEntry(options.initialValues[name]);
	} else if (field.default != null) {
		attr.defaultValue = valueToInputEntry(field.default);
	}

	if (isRequired) {
		attr.required = true;
	}

	if (field.description) {
		attr["aria-label"] = field.description;
	}

	if (field.type === "number" || field.type === "integer") {
		attr.type = "number";
	} else if (name === "password") {
		attr.type = "password";
	} else if (name === "email") {
		attr.type = "email";
	} else if (name === "url") {
		attr.type = "url";
	} else if (field.type === "string") {
		if (field.format === "binary") {
			attr.type = "file";
		} else if (field.format === "date") {
			attr.type = "date";
		} else if (field.format === "time") {
			attr.type = "time";
		} else if (field.format === "date-time") {
			attr.type = "datetime-local";
		} else {
			attr.type = "text";
		}
	} else if (field.type === "boolean") {
		attr.type = "checkbox";
	}

	if (options.onCreateField) {
		const customAttr = options.onCreateField(name, field);
		Object.assign(attr, customAttr);
	}

	return {
		path,
		props: attr,
		schema: field,
	};
};

export const getValueFromInput = (
	input: FormDataEntryValue,
	schema: TSchema,
): any => {
	if (input instanceof File) {
		// For file inputs, return the File object directly
		if (schema.format === "binary") {
			return input;
		}
		// for now, ignore other formats
		return null;
	}

	if (schema.type === "boolean") {
		return input === "on";
	}

	if (schema.type === "number" || schema.type === "integer") {
		const num = Number(input);
		return Number.isNaN(num) ? null : num;
	}

	if (schema.type === "string") {
		if (schema.format === "date") {
			return new Date(input).toISOString().slice(0, 10); // For date input
		}
		if (schema.format === "time") {
			return new Date(`1970-01-01T${input}`).toISOString().slice(11, 16); // For time input
		}
		if (schema.format === "date-time") {
			return new Date(input).toISOString(); // For datetime-local input
		}
		return String(input);
	}

	return input; // Fallback for other types
};

export const valueToInputEntry = (value: any): string | number => {
	if (value === null || value === undefined) {
		return "";
	}

	if (typeof value === "boolean") {
		return value ? "true" : "false";
	}

	if (typeof value === "number") {
		return value;
	}

	if (typeof value === "string") {
		return value;
	}

	if (value instanceof Date) {
		return value.toISOString().slice(0, 16); // For datetime-local input
	}

	return String(value);
};

export type UseFormOptions<T extends TObject> = {
	/**
	 * The schema defining the structure and validation rules for the form.
	 * This should be a TypeBox schema object.
	 */
	schema: T;

	/**
	 * Callback function to handle form submission.
	 * This function will receive the parsed and validated form values.
	 */
	handler: (values: Static<T>, args: { form: HTMLFormElement }) => void;

	/**
	 * Optional initial values for the form fields.
	 * This can be used to pre-populate the form with existing data.
	 */
	initialValues?: Static<T>;

	/**
	 * Optional function to create custom field attributes.
	 * This can be used to add custom validation, styles, or other attributes.
	 */
	onCreateField?: (
		name: keyof Static<T> & string,
		schema: TSchema,
	) => InputHTMLAttributes<unknown>;

	/**
	 * If defined, this will generate a unique ID for each field, prefixed with this string.
	 *
	 * > "username" with id="form-123" will become "form-123-username".
	 *
	 * If omitted, IDs will not be generated.
	 */
	id?: string;

	onError?: (error: TypeBoxError, args: { form: HTMLFormElement }) => void;

	onChange?: (key: string, value: any) => void;
};

export type UseFormReturn<T extends TObject> = {
	/**
	 * Function to handle form submission.
	 * This should be attached to the form's onSubmit event.
	 *
	 * @example
	 * ```tsx
	 * const form = useForm();
	 *
	 * return <form onSubmit={form.onSubmit}></form>;
	 * ```
	 */
	onSubmit?: (event: FormEventLike) => void;

	/**
	 * Creates an input field for the specified schema property.
	 */
	input: SchemaToInput<T>;
};

export type SchemaToInput<T extends TObject> = {
	[K in keyof T["properties"]]: T["properties"][K] extends TObject
		? SchemaToInput<T["properties"][K]>
		: InputField;
};

export interface FormEventLike {
	currentTarget: HTMLFormElement;
	preventDefault: () => void;
}

export interface InputField {
	path: string;
	props: InputHTMLAttributesLike;
	schema: TSchema;
}

export type InputHTMLAttributesLike = Pick<
	InputHTMLAttributes<unknown>,
	| "id"
	| "name"
	| "type"
	| "value"
	| "defaultValue"
	| "onChange"
	| "required"
	| "maxLength"
	| "minLength"
	| "aria-label"
> & {
	value?: any;
	defaultValue?: any;
};
