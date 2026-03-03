import type { TArray } from "alepha";
import {
  $inject,
  Alepha,
  type Static,
  type TObject,
  type TSchema,
  t,
} from "alepha";
import { $logger } from "alepha/logger";
import type { InputHTMLAttributes } from "react";

/**
 * FormModel is a dynamic form handler that generates form inputs based on a provided TypeBox schema.
 * It manages form state, handles input changes, and processes form submissions with validation.
 *
 * It means to be injected and used within React components to provide a structured way to create and manage forms.
 *
 * @see {@link useForm}
 */
export class FormModel<T extends TObject> {
  protected readonly log = $logger();
  protected readonly alepha = $inject(Alepha);
  protected readonly values: Record<string, any> = {};
  protected readonly initialValues: Record<string, any> = {};
  protected submitInProgress = false;

  public input: SchemaToInput<T>;

  public get submitting(): boolean {
    return this.submitInProgress;
  }

  constructor(
    public readonly id: string,
    public readonly options: FormCtrlOptions<T>,
  ) {
    this.options = options;

    // Initialize with schema defaults first, then override with initialValues
    const schemaDefaults = this.extractSchemaDefaults(options.schema);
    if (Object.keys(schemaDefaults).length > 0) {
      Object.assign(this.values, schemaDefaults);
    }

    if (options.initialValues) {
      const decoded = this.alepha.codec.decode(
        options.schema,
        options.initialValues,
      ) as Record<string, any>;
      Object.assign(this.values, decoded);
    }

    this.initialValues = { ...this.values };

    this.input = this.createProxyFromSchema(options, options.schema, {
      store: this.values,
      parent: "",
    });
  }

  /**
   * Extract default values from a TypeBox schema.
   * Recursively handles nested objects.
   */
  protected extractSchemaDefaults(
    schema: TObject,
    prefix: string = "",
  ): Record<string, any> {
    const defaults: Record<string, any> = {};

    if (!schema.properties) {
      return defaults;
    }

    for (const [key, propSchema] of Object.entries(schema.properties)) {
      const fullKey = prefix ? `${prefix}.${key}` : key;

      if ("default" in propSchema && propSchema.default !== undefined) {
        defaults[fullKey] = propSchema.default;
      } else if (
        propSchema &&
        "type" in propSchema &&
        propSchema.type === "object" &&
        "properties" in propSchema
      ) {
        // Recursively extract defaults from nested objects
        const nestedDefaults = this.extractSchemaDefaults(
          propSchema as TObject,
          fullKey,
        );
        Object.assign(defaults, nestedDefaults);
      }
    }

    return defaults;
  }

  public get currentValues(): Record<string, any> {
    return this.restructureValues(this.values);
  }

  public get props() {
    return {
      id: this.id,
      noValidate: true,
      onSubmit: (ev?: FormEventLike) => {
        ev?.preventDefault?.();
        this.submit();
      },
      onReset: (event: FormEventLike) => this.reset(event),
    };
  }

  public readonly setInitialValues = (values: Record<string, any>) => {
    const decoded = this.alepha.codec.decode(
      this.options.schema,
      values,
    ) as Record<string, any>;

    for (const key in this.initialValues) {
      delete (this.initialValues as Record<string, any>)[key];
    }
    Object.assign(this.initialValues, decoded);

    for (const key in this.values) {
      delete this.values[key];
    }
    Object.assign(this.values, { ...this.initialValues });

    for (const [key, value] of Object.entries(this.values)) {
      const path = `/${key.replaceAll(".", "/")}`;
      this.alepha.events.emit(
        "form:change",
        { id: this.id, path, value },
        { catch: true },
      );
    }
  };

  public readonly reset = (event?: FormEventLike) => {
    event?.preventDefault?.();
    for (const key in this.values) {
      delete this.values[key];
    }
    Object.assign(this.values, { ...this.initialValues });
    for (const [key, value] of Object.entries(this.values)) {
      const path = `/${key.replaceAll(".", "/")}`;
      this.alepha.events.emit(
        "form:change",
        { id: this.id, path, value },
        { catch: true },
      );
    }
    this.alepha.events.emit("form:reset", { id: this.id }, { catch: true });
    this.options.onReset?.();
  };

  public readonly submit = async () => {
    if (this.submitInProgress) {
      this.log.warn(
        "Form submission already in progress, ignoring duplicate submit.",
      );
      return;
    }

    // emit both action and form events
    await this.alepha.events.emit("react:action:begin", {
      type: "form",
      id: this.id,
    });
    await this.alepha.events.emit("form:submit:begin", {
      id: this.id,
    });

    this.submitInProgress = true;

    const options = this.options;

    try {
      let values: Record<string, any> = this.restructureValues(this.values);

      if (t.schema.isSchema(options.schema)) {
        values = this.alepha.codec.decode(options.schema, values) as Record<
          string,
          any
        >;
      }

      await options.handler(values as any);

      await this.alepha.events.emit("react:action:success", {
        type: "form",
        id: this.id,
      });
      await this.alepha.events.emit("form:submit:success", {
        id: this.id,
        values,
      });
    } catch (error) {
      this.log.error("Form submission error:", error);

      options.onError?.(error as Error);

      await this.alepha.events.emit("react:action:error", {
        type: "form",
        id: this.id,
        error: error as Error,
      });
      await this.alepha.events.emit("form:submit:error", {
        error: error as Error,
        id: this.id,
      });
    } finally {
      this.submitInProgress = false;
    }

    await this.alepha.events.emit("react:action:end", {
      type: "form",
      id: this.id,
    });
    await this.alepha.events.emit("form:submit:end", {
      id: this.id,
    });
  };

  /**
   * Restructures flat keys like "address.city" into nested objects like { address: { city: ... } }
   * Values are already typed from onChange, so no conversion is needed.
   */
  protected restructureValues(store: Record<string, any>): Record<string, any> {
    const values: Record<string, any> = {};

    for (const [key, value] of Object.entries(store)) {
      if (key.includes(".")) {
        // nested object: restructure flat key to nested structure
        this.restructureNestedValue(values, key, value);
      } else {
        // value is already typed, just copy it
        values[key] = value;
      }
    }

    return values;
  }

  /**
   * Helper to restructure a flat key like "address.city" into nested object structure.
   * The value is already typed, so we just assign it to the nested path.
   */
  protected restructureNestedValue(
    values: Record<string, any>,
    key: string,
    value: any,
  ) {
    const pathSegments = key.split(".");
    const finalPropertyKey = pathSegments.pop();
    if (!finalPropertyKey) {
      return;
    }

    let currentObjectLevel = values;

    // traverse/create the nested structure
    for (const segment of pathSegments) {
      currentObjectLevel[segment] ??= {};
      currentObjectLevel = currentObjectLevel[segment];
    }

    // value is already typed from onChange, just assign it
    currentObjectLevel[finalPropertyKey] = value;
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
        if (!options.schema || !t.schema.isObject(schema)) {
          return {};
        }

        if (prop in schema.properties) {
          // // it's a nested object, create another proxy
          // if (t.schema.isObject(schema.properties[prop])) {
          //   return this.createProxyFromSchema(
          //     options,
          //     schema.properties[prop],
          //     {
          //       parent: parent ? `${parent}.${prop}` : prop,
          //       store: context.store,
          //     },
          //   );
          // }

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
    schema: TObject,
    required: boolean,
    context: {
      parent: string;
      store: Record<string, any>;
    },
  ): BaseInputField {
    const parent = context.parent || "";
    const field = schema.properties?.[name];
    if (!field) {
      return {
        path: "",
        required,
        initialValue: undefined,
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
      const typedValue = this.getValueFromInput(value, field);
      context.store[key] = typedValue;
      if (options.onChange) {
        options.onChange(key, typedValue, context.store);
      }
      this.alepha.events.emit(
        "form:change",
        { id: this.id, path: path, value: typedValue },
        { catch: true },
      );
    };

    const attr: InputHTMLAttributesLike = {
      name: key,
    };

    if (options.id) {
      attr.id = `${options.id}-${key}`;
      (attr as any)["data-testid"] = attr.id;
    }

    if (t.schema.isString(field)) {
      if (field.maxLength != null) {
        attr.maxLength = Number(field.maxLength);
      }

      if (field.minLength != null) {
        attr.minLength = Number(field.minLength);
      }
    }

    if (isRequired) {
      attr.required = true;
    }

    if ("description" in field && typeof field.description === "string") {
      attr["aria-label"] = field.description;
    }

    if (t.schema.isInteger(field) || t.schema.isNumber(field)) {
      attr.type = "number";
    } else if (name === "password") {
      attr.type = "password";
    } else if (name === "email") {
      attr.type = "email";
    } else if (name === "url") {
      attr.type = "url";
    } else if (t.schema.isString(field)) {
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
    } else if (t.schema.isBoolean(field)) {
      attr.type = "checkbox";
    }

    if (options.onCreateField) {
      const customAttr = options.onCreateField(name, field);
      Object.assign(attr, customAttr);
    }

    // if type = object, add items: { [key: string]: InputField }
    if (t.schema.isObject(field)) {
      return {
        path,
        props: attr,
        schema: field,
        set,
        form: this,
        required,
        initialValue: context.store[key],
        items: this.createProxyFromSchema(options, field, {
          parent: key,
          store: context.store,
        }),
      } as ObjectInputField<any>;
    }

    // if type = array, add items: InputField[]
    if (t.schema.isArray(field)) {
      return {
        path,
        props: attr,
        schema: field,
        set,
        form: this,
        required,
        initialValue: context.store[key],
        items: [], // <- will be populated dynamically in the UI
      } as ArrayInputField<any>;
    }

    return {
      path,
      props: attr,
      schema: field,
      set,
      form: this,
      required,
      initialValue: context.store[key],
    };
  }

  /**
   * Convert an input value to the correct type based on the schema.
   * Handles raw DOM values (strings, booleans from checkboxes, Files, etc.)
   */
  protected getValueFromInput(input: any, schema: TSchema): any {
    if (input instanceof File) {
      // for file inputs, return the File object directly
      if (t.schema.isString(schema) && schema.format === "binary") {
        return input;
      }
      // for now, ignore other formats
      return null;
    }

    if (t.schema.isBoolean(schema)) {
      // Handle string representations from Select components (Yes/No dropdown)
      if (input === "true") return true;
      if (input === "false") return false;
      if (input === "" || input === null || input === undefined)
        return undefined;
      // Handle actual boolean values
      return !!input;
    }

    if (t.schema.isNumber(schema)) {
      const num = Number(input);
      return Number.isNaN(num) ? null : num;
    }

    if (t.schema.isString(schema)) {
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

    return input; // fallback for other types
  }
}

export type SchemaToInput<T extends TObject> = {
  [K in keyof T["properties"]]: InputField<T["properties"][K]>;
};

export interface FormEventLike {
  preventDefault?: () => void;
  stopPropagation?: () => void;
}

export type InputField<T extends TSchema> = T extends TObject
  ? ObjectInputField<T>
  : T extends TArray<infer U>
    ? ArrayInputField<U>
    : BaseInputField;

export interface BaseInputField {
  path: string;
  required: boolean;
  initialValue: any;
  props: InputHTMLAttributesLike;
  schema: TSchema;
  set: (value: any) => void;
  form: FormModel<any>;
  items?: any;
}

export interface ObjectInputField<T extends TObject> extends BaseInputField {
  items: SchemaToInput<T>;
}

export interface ArrayInputField<T extends TSchema> extends BaseInputField {
  items: Array<InputField<T>>;
}

export type InputHTMLAttributesLike = Pick<
  InputHTMLAttributes<unknown>,
  | "id"
  | "name"
  | "type"
  | "value"
  | "required"
  | "maxLength"
  | "minLength"
  | "aria-label"
> & {
  value?: any;
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
  handler: (values: Static<T>) => unknown;

  /**
   * Optional initial values for the form fields.
   * This can be used to pre-populate the form with existing data.
   */
  initialValues?: Partial<Static<T>>;

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

  onError?: (error: Error) => void;

  onChange?: (key: string, value: any, store: Record<string, any>) => void;

  onReset?: () => void;
};
