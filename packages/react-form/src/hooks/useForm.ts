import {
	type Static,
	type TObject,
	type TSchema,
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

	const onSubmit = (event: FormEventLike) => {
		event.preventDefault();

		const form = event.currentTarget;
		const formData = new FormData(form);
		const values: Record<string, any> = {};

		for (const [key, value] of formData.entries()) {
			if (options.schema.properties[key] != null) {
				values[key] = inputToValue(value, options.schema.properties[key]);
			}
		}

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
			alepha.log.error("Form validation failed:", error);
		}
	};

	return {
		onSubmit,
		input: (name: string) => createField<T>(name, options),
	};
};

const createField = <T extends TObject>(
	name: keyof Static<T> & string,
	options: UseFormOptions<T>,
): InputHTMLAttributes<unknown> => {
	const schema = options.schema?.properties?.[name];
	if (!schema) {
		return {} as InputHTMLAttributes<unknown>;
	}

	const isRequired = options.schema.required?.includes(name) ?? false;

	const attr: InputHTMLAttributes<unknown> = {
		name,
		onChange: (event: React.ChangeEvent<HTMLInputElement>) => {
			const value = event.target.value;
			// Handle field change logic here if needed
			if (options.onValuesChange) {
				options.onValuesChange(
					{ ...options.initialValues, [name]: value } as Static<T>,
					{},
				);
			}
		},
	};

	if (options.id) {
		attr.id = `${options.id}-${name}`;
	}

	if (schema.maxLength != null) {
		attr.maxLength = Number(schema.maxLength);
	}

	if (schema.minLength != null) {
		attr.minLength = Number(schema.minLength);
	}

	if (options.initialValues?.[name] != null) {
		attr.defaultValue = valueToInput(options.initialValues[name]);
	} else if (schema.default != null) {
		attr.defaultValue = valueToInput(schema.default);
	}

	if (isRequired) {
		attr.required = true;
	}

	if (schema.description) {
		attr["aria-label"] = schema.description;
	}

	if (schema.type === "number" || schema.type === "integer") {
		attr.type = "number";
	} else if (name === "password") {
		attr.type = "password";
	} else if (name === "email") {
		attr.type = "email";
	} else if (name === "url") {
		attr.type = "url";
	} else if (schema.type === "string") {
		if (schema.format === "binary") {
			attr.type = "file";
		} else if (schema.format === "date") {
			attr.type = "date";
		} else if (schema.format === "time") {
			attr.type = "time";
		} else if (schema.format === "date-time") {
			attr.type = "datetime-local";
		} else {
			attr.type = "text";
		}
	} else if (schema.type === "boolean") {
		attr.type = "checkbox";
	}

	if (options.onCreateField) {
		const customAttr = options.onCreateField(name, schema);
		Object.assign(attr, customAttr);
	}

	return attr;
};

export const inputToValue = (input: any, schema: TSchema): any => {
	if (schema.type === "boolean") {
		return input === "on";
	}
	if (schema.type === "number" || schema.type === "integer") {
		const num = Number(input);
		return Number.isNaN(num) ? null : num;
	}
	if (schema.format === "binary") {
		return input instanceof File ? input : null;
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

export const valueToInput = (value: any): string | number => {
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
	 * Optional callback to handle changes in form values.
	 * This can be used to update state or perform side effects when values change.
	 */
	onValuesChange?: (values: Static<T>, previous: Static<T>) => void;

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
	input: (name: keyof Static<T> & string) => InputHTMLAttributes<unknown>;
};

export interface FormEventLike {
	currentTarget: HTMLFormElement;
	preventDefault: () => void;
}
