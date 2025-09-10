import {
	$inject,
	Alepha,
	type Static,
	type TObject,
	type TSchema,
	TypeGuard,
} from "@alepha/core";
import { $logger } from "@alepha/logger";
import type { ChangeEvent, InputHTMLAttributes } from "react";

export class FormModel<T extends TObject> {
	protected readonly log = $logger();
	protected readonly alepha = $inject(Alepha);
	protected readonly values: Record<string, any> = {};

	public input: SchemaToInput<T>;

	constructor(
		public readonly id: string,
		protected readonly options: FormCtrlOptions<T>,
	) {
		this.options = options;

		if (options.initialValues) {
			this.values = this.alepha.parse(options.schema, options.initialValues);
		}

		this.input = this.createProxyFromSchema(options, options.schema, {
			store: this.values,
			parent: "",
		});
	}

	public readonly onSubmit = async (event: FormEventLike) => {
		event.preventDefault();
		this.alepha.emit("form:submit:begin", {
			id: this.id,
		});
		const options = this.options;

		const form = event.currentTarget;
		const values: Record<string, any> = this.parseValuesFromFormElement(
			options,
			this.values,
		);

		const args = {
			form,
		};

		try {
			if (TypeGuard.IsSchema(options.schema)) {
				await options.handler(this.alepha.parse(options.schema, values), args);
			} else {
				await options.handler(values, args); // for now, trust
			}
			this.alepha.emit("form:submit:success", {
				id: this.id,
			});
		} catch (error) {
			this.log.error("Form submission error:", error);

			options.onError?.(error as Error, args);

			this.alepha.emit("form:submit:error", { error, id: this.id });
		}

		this.alepha.emit("form:submit:end", {
			id: this.id,
		});
	};

	protected parseValuesFromFormElement<T extends TObject>(
		options: FormCtrlOptions<T>,
		store: Record<string, any>,
	): Record<string, any> {
		const values: Record<string, any> = {};

		for (const [key, value] of Object.entries(store)) {
			if (key.includes(".")) {
				// addon: support for nested objects
				this.getValueFromInputObject(options, values, key, value);
			} else if (options.schema?.properties[key] != null) {
				values[key] = this.getValueFromInput(
					value,
					options.schema.properties[key],
				);
			}
		}

		return values;
	}

	protected getValueFromInputObject<T extends TObject>(
		options: FormCtrlOptions<T>,
		values: Record<string, any>,
		key: string,
		value: FormDataEntryValue,
	) {
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
			currentObjectLevel[finalPropertyKey] = this.getValueFromInput(
				value,
				finalPropertySchema,
			);
		}
	}

	protected createProxyFromSchema<T extends TObject>(
		options: FormCtrlOptions<T>,
		schema: TSchema,
		context: {
			parent: string;
			store: Record<string, any>;
		},
	): SchemaToInput<T> {
		const parent = context.parent || "";
		return new Proxy<SchemaToInput<T>>({} as SchemaToInput<T>, {
			get: (_, prop: string) => {
				if (!options.schema) {
					return {};
				}
				if (prop in schema.properties) {
					if (schema.properties[prop].type === "object") {
						return this.createProxyFromSchema(
							options,
							schema.properties[prop],
							{
								parent: parent ? `${parent}.${prop}` : prop,
								store: context.store,
							},
						);
					}
					return this.createInputFromSchema<T>(
						prop as keyof Static<T> & string,
						options,
						schema,
						schema.required?.includes(prop as string) || false,
						context,
					);
				}
			},
		});
	}

	protected createInputFromSchema<T extends TObject>(
		name: keyof Static<T> & string,
		options: FormCtrlOptions<T>,
		schema: TSchema,
		required: boolean,
		context: {
			parent: string;
			store: Record<string, any>;
		},
	): InputField {
		const parent = context.parent || "";
		const field = schema.properties?.[name];
		if (!field) {
			return {
				path: "",
				required,
				props: {} as InputHTMLAttributes<unknown>,
				schema: schema,
				set: () => {},
				form: this,
			};
		}

		const isRequired = schema.required?.includes(name) ?? false;

		const key = parent ? `${parent}.${name}` : name;
		const path = `/${key.replaceAll(".", "/")}`;

		const set = (value: any) => {
			if (context.store[key] === value) {
				// no change, do not update
				return;
			}

			context.store[key] = value;

			if (options.onChange) {
				options.onChange(key, value, context.store);
			}

			this.alepha.emit("form:change", {
				id: this.id,
				path: path,
			});
		};

		const attr: InputHTMLAttributesLike = {
			name: key,
			onChange: (event: ChangeEvent<HTMLInputElement> | string) => {
				if (typeof event === "string") {
					// If the event is a string, it means it's a direct value change
					set(event);
					return;
				}

				if (field.type === "boolean") {
					set(event.target.checked);
				} else {
					set(event.target.value);
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
			attr.defaultValue = this.valueToInputEntry(options.initialValues[name]);
		} else if (field.default != null) {
			attr.defaultValue = this.valueToInputEntry(field.default);
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
			set,
			form: this,
			required,
		};
	}

	protected getValueFromInput(input: FormDataEntryValue, schema: TSchema): any {
		if (input instanceof File) {
			// For file inputs, return the File object directly
			if (schema.format === "binary") {
				return input;
			}
			// for now, ignore other formats
			return null;
		}

		if (schema.type === "boolean") {
			return !!input;
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
	}

	protected valueToInputEntry(value: any): string | number | boolean {
		if (value === null || value === undefined) {
			return "";
		}

		if (typeof value === "boolean") {
			return value;
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

		return value;
	}
}

export type SchemaToInput<T extends TObject> = {
	[K in keyof T["properties"]]: T["properties"][K] extends TObject
		? SchemaToInput<T["properties"][K]>
		: InputField;
};

export interface FormEventLike {
	currentTarget: any;
	preventDefault: () => void;
	stopPropagation: () => void;
}

export interface InputField {
	path: string;
	required: boolean;
	props: InputHTMLAttributesLike;
	schema: TSchema;
	set: (value: any) => void;
	form: FormModel<any>;
}

export type InputHTMLAttributesLike = Pick<
	InputHTMLAttributes<unknown>,
	| "id"
	| "name"
	| "type"
	| "value"
	| "defaultValue"
	| "required"
	| "maxLength"
	| "minLength"
	| "aria-label"
> & {
	value?: any;
	defaultValue?: any;
	onChange?: (event: any) => void;
};

export type FormCtrlOptions<T extends TObject> = {
	/**
	 * The schema defining the structure and validation rules for the form.
	 * This should be a TypeBox schema object.
	 */
	schema: T;

	/**
	 * Callback function to handle form submission.
	 * This function will receive the parsed and validated form values.
	 */
	handler: (values: Static<T>, args: { form: HTMLFormElement }) => unknown;

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

	onError?: (error: Error, args: { form: HTMLFormElement }) => void;

	onChange?: (key: string, value: any, store: Record<string, any>) => void;
};
