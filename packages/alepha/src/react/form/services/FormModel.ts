import type { TArray } from "alepha";
import {
  $inject,
  Alepha,
  coerceObject,
  type Static,
  type TObject,
  type TSchema,
  z,
} from "alepha";
import { $logger } from "alepha/logger";
import type { ChangeEvent, InputHTMLAttributes } from "react";

/**
 * FormModel is a dynamic form handler that generates form inputs based on a provided Zod schema.
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
      // Decode against a partial of the schema so callers can supply incomplete
      // initial values (the form's whole job is to collect them). Codecs still
      // run on whatever's provided; missing fields stay undefined and only the
      // full schema is enforced at submit time.
      const decoded = this.alepha.codec.decode(
        options.schema.partial(),
        options.initialValues,
      ) as Record<string, any>;
      Object.assign(
        this.values,
        this.flattenObjectValues(options.schema, decoded),
      );
    }

    this.initialValues = { ...this.values };

    this.input = this.createProxyFromSchema(options, options.schema, {
      store: this.values,
      parent: "",
    });
  }

  /**
   * Flatten nested OBJECT values into the store's dotted-key convention.
   *
   * The store is flat on purpose — `createInputFromSchema` keys nested inputs
   * as `payg.dailyCapCents` and `restructureValues()` rebuilds the nesting at
   * submit time — and `extractSchemaDefaults` already emits dotted keys. Caller
   * `initialValues`, however, arrive NESTED (that is the shape of an API
   * payload), so without this pass `values.payg` sits there as one opaque
   * object while every nested input reads `values["payg.dailyCapCents"]` and
   * finds nothing: the controls render empty, and editing one writes a fresh
   * dotted key while the stale nested object survives into the submit payload.
   *
   * The parent key is KEPT alongside its flattened children: `ControlObject`
   * uses it to tell an initialized object from an absent optional one.
   * Recursion is schema-driven, so arrays (handled whole by `ControlArray`)
   * and leaf values are left untouched.
   */
  protected flattenObjectValues(
    schema: TObject,
    values: Record<string, any>,
    prefix = "",
  ): Record<string, any> {
    const flat: Record<string, any> = {};
    const shape = (schema as any).shape as Record<string, any> | undefined;

    for (const [key, value] of Object.entries(values)) {
      const fullKey = prefix ? `${prefix}.${key}` : key;
      flat[fullKey] = value;

      const fieldSchema = shape?.[key];
      if (!fieldSchema || value == null || typeof value !== "object") {
        continue;
      }
      const inner = z.schema.unwrap(fieldSchema);
      if (!z.schema.isObject(inner) || Array.isArray(value)) {
        continue;
      }
      Object.assign(
        flat,
        this.flattenObjectValues(
          inner as TObject,
          value as Record<string, any>,
          fullKey,
        ),
      );
    }

    return flat;
  }

  /**
   * Extract default values from a zod object schema.
   * Recursively handles nested objects, unwrapping optional/nullable/default.
   */
  protected extractSchemaDefaults(
    schema: TObject,
    prefix: string = "",
  ): Record<string, any> {
    const defaults: Record<string, any> = {};
    const shape = (schema as any).shape as Record<string, any> | undefined;

    if (!shape) {
      return defaults;
    }

    for (const [key, propSchema] of Object.entries(shape)) {
      const fullKey = prefix ? `${prefix}.${key}` : key;

      // Unwrap optional / nullable / default wrappers to surface a default
      // value and any nested object schema.
      let inner: any = propSchema;
      let defaultValue: unknown;
      while (inner) {
        if (z.schema.isDefault(inner)) {
          const dv = inner._zod.def.defaultValue;
          defaultValue = typeof dv === "function" ? dv() : dv;
          break;
        }
        if (z.schema.isOptional(inner) || z.schema.isNullable(inner)) {
          inner = inner.unwrap();
          continue;
        }
        break;
      }

      if (defaultValue !== undefined) {
        defaults[fullKey] = defaultValue;
      } else if (z.schema.isObject(inner)) {
        // Recursively extract defaults from nested objects
        Object.assign(
          defaults,
          this.extractSchemaDefaults(inner as TObject, fullKey),
        );
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
    // Same partial-decode rationale as the constructor — initial values may be
    // incomplete; full schema is enforced only at submit time.
    const decoded = this.flattenObjectValues(
      this.options.schema,
      this.alepha.codec.decode(this.options.schema.partial(), values) as Record<
        string,
        any
      >,
    );

    // Snapshot the OLD keys before we wipe — without this, fields that
    // had a value but are absent from the new initialValues never emit
    // form:change and useFieldValue subscribers keep showing the stale
    // value. Mirrors the union-of-keys pattern in reset() below.
    const oldKeys = new Set(Object.keys(this.values));

    for (const key in this.initialValues) {
      delete (this.initialValues as Record<string, any>)[key];
    }
    Object.assign(this.initialValues, decoded);

    for (const key in this.values) {
      delete this.values[key];
    }
    Object.assign(this.values, { ...this.initialValues });

    const keys = new Set<string>([...oldKeys, ...Object.keys(this.values)]);
    for (const key of keys) {
      const path = `/${key.replaceAll(".", "/")}`;
      this.alepha.events.emit(
        "form:change",
        { id: this.id, path, value: this.values[key], initial: true },
        { catch: true },
      );
    }
  };

  public readonly reset = (event?: FormEventLike) => {
    event?.preventDefault?.();
    // Snapshot all keys that need notification — both keys present
    // before reset (so subscribers learn the cleared value) and keys
    // restored from initialValues. Without the union, fields that were
    // typed but absent from initialValues stay visually stale.
    const keys = new Set<string>([
      ...Object.keys(this.values),
      ...Object.keys(this.initialValues),
    ]);
    for (const key in this.values) {
      delete this.values[key];
    }
    Object.assign(this.values, { ...this.initialValues });
    for (const key of keys) {
      const path = `/${key.replaceAll(".", "/")}`;
      this.alepha.events.emit(
        "form:change",
        { id: this.id, path, value: this.values[key] },
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

    // Claimed SYNCHRONOUSLY, before the first await. The flag used to be set
    // only after the two awaited emits below, so a second submit arriving
    // during them sailed past the guard and ran the handler twice — a
    // double-clicked button charging a card twice.
    this.submitInProgress = true;

    // Lifecycle events are best-effort NOTIFICATIONS (loading spinners, toasts,
    // analytics). A misbehaving listener must never break form state or reject
    // submit() — hence `{ catch: true }` on every emit below. Without it, a
    // throwing `react:action:error`/`form:submit:error` listener would skip the
    // `form:submit:end` "loading off" signal and leave submit buttons stuck in
    // their loading state forever.
    await this.alepha.events.emit(
      "react:action:begin",
      { type: "form", id: this.id },
      { catch: true },
    );
    await this.alepha.events.emit(
      "form:submit:begin",
      { id: this.id },
      { catch: true },
    );

    const options = this.options;

    try {
      let values: Record<string, any> = this.restructureValues(this.values);

      if (z.schema.isSchema(options.schema)) {
        // HTML form controls produce strings; coerce them to the schema's
        // scalar types (number/boolean) at this string boundary before strict
        // decoding — otherwise a `z.number()` field would reject its "42" input.
        values = this.alepha.codec.decode(
          options.schema,
          coerceObject(options.schema, values),
        ) as Record<string, any>;
      }

      await options.handler(values as any);

      await this.alepha.events.emit(
        "react:action:success",
        { type: "form", id: this.id },
        { catch: true },
      );
      await this.alepha.events.emit(
        "form:submit:success",
        { id: this.id, values },
        { catch: true },
      );
    } catch (error) {
      this.log.error("Form submission error:", error);

      // A throwing onError callback must not abort the lifecycle either.
      try {
        options.onError?.(error as Error);
      } catch (handlerError) {
        this.log.error("Form onError handler threw:", handlerError);
      }

      await this.alepha.events.emit(
        "react:action:error",
        { type: "form", id: this.id, error: error as Error },
        { catch: true },
      );
      await this.alepha.events.emit(
        "form:submit:error",
        { error: error as Error, id: this.id },
        { catch: true },
      );
    } finally {
      this.submitInProgress = false;

      // The "loading off" signals live in `finally` so they ALWAYS fire,
      // even if something above threw — guaranteeing the begin/end pairing
      // that drives submit-button loading state.
      await this.alepha.events.emit(
        "react:action:end",
        { type: "form", id: this.id },
        { catch: true },
      );
      await this.alepha.events.emit(
        "form:submit:end",
        { id: this.id },
        { catch: true },
      );
    }
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
      } else if (
        value != null &&
        typeof value === "object" &&
        !Array.isArray(value) &&
        Object.getPrototypeOf(value) === Object.prototype
      ) {
        // A parent object key coexists with its flattened children (see
        // flattenObjectValues): copy it so the nested writes below land on
        // OUR object and never mutate the caller's initialValues.
        values[key] = { ...value };
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
        if (!options.schema || !z.schema.isObject(schema)) {
          return {};
        }

        if (prop in schema.properties) {
          // // it's a nested object, create another proxy
          // if (z.schema.isObject(schema.properties[prop])) {
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
            z.schema.requiredKeys(schema).includes(prop as string) || false,
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
    const rawField = schema.properties?.[name];
    if (!rawField) {
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
    // Peel optional/nullable/default wrappers so the structural guards below
    // (`isObject`/`isArray`/`isString`/…, `.maxLength`, format) see the real
    // schema. Optionality is tracked separately via `isRequired`/`required`.
    const field = z.schema.unwrap(rawField) as typeof rawField;

    const isRequired = z.schema.requiredKeys(schema).includes(name) ?? false;
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

    // Use the form's runtime id (always set — comes from `useId()` when
    // no explicit `options.id` was provided). This guarantees stable
    // per-field DOM ids without forcing callers to pass `id`.
    attr.id = `${this.id}-${key}`;
    (attr as any)["data-testid"] = attr.id;

    if (z.schema.isString(field)) {
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

    if (z.schema.isInteger(field) || z.schema.isNumber(field)) {
      attr.type = "number";
    } else if (name === "password") {
      attr.type = "password";
    } else if (name === "email") {
      attr.type = "email";
    } else if (name === "url") {
      attr.type = "url";
    } else if (z.schema.isString(field)) {
      if (z.schema.format(field) === "binary") {
        attr.type = "file";
      } else if (z.schema.format(field) === "date") {
        attr.type = "date";
      } else if (z.schema.format(field) === "time") {
        attr.type = "time";
      } else if (z.schema.format(field) === "date-time") {
        attr.type = "datetime-local";
      } else {
        attr.type = "text";
      }
    } else if (z.schema.isBoolean(field)) {
      attr.type = "checkbox";
    }

    // Self-wiring. `<input {...form.input.username.props} />` — the pattern
    // useForm's own JSDoc documents — used to produce an input that fed
    // nothing back: `props` carried id/name/type/validation only, so whatever
    // the user typed stayed in the DOM and `submit()` shipped an empty object.
    //
    // Uncontrolled (`defaultValue` + `onChange`) rather than controlled: form
    // values live in the model, not in React state, so a keystroke must not
    // re-render the tree. `useFieldValue` stays the opt-in for reactive reads.
    // Container fields (object/array) are excluded — they render children, not
    // an input. Assigned before `onCreateField` so a caller can still override.
    if (!z.schema.isObject(field) && !z.schema.isArray(field)) {
      const initialValue = context.store[key];
      if (attr.type === "checkbox") {
        attr.defaultChecked = initialValue === true;
      } else if (attr.type !== "file" && initialValue != null) {
        attr.defaultValue = initialValue;
      }

      attr.onChange = (event: ChangeEvent<HTMLInputElement>) => {
        const target = event.target;
        if (target.type === "checkbox") {
          set(target.checked);
        } else if (target.type === "file") {
          set(target.files?.[0]);
        } else {
          set(target.value);
        }
      };
    }

    if (options.onCreateField) {
      const customAttr = options.onCreateField(name, field);
      Object.assign(attr, customAttr);
    }

    // if type = object, add items: { [key: string]: InputField }
    if (z.schema.isObject(field)) {
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
    if (z.schema.isArray(field)) {
      return {
        path,
        props: attr,
        schema: field,
        set,
        form: this,
        required,
        initialValue: context.store[key],
        items: [], // see ArrayInputField — the UI builds the per-row fields
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
    // Treat null/undefined as "unset" for every schema. Without this the
    // string branch below stringifies them to "null"/"undefined" (and
    // the date branches throw on `new Date(undefined)`), which then
    // round-trips into controlled inputs as literal text — most
    // visible after the Clear (X) affordance in Control sets
    // value=undefined and the input promptly displays "undefined".
    if (input === null || input === undefined) {
      return undefined;
    }
    if (input instanceof File) {
      // for file inputs, return the File object directly
      if (z.schema.isString(schema) && z.schema.format(schema) === "binary") {
        return input;
      }
      // for now, ignore other formats
      return null;
    }

    if (z.schema.isBoolean(schema)) {
      // Handle string representations from Select components (Yes/No dropdown)
      if (input === "true") return true;
      if (input === "false") return false;
      if (input === "" || input === null || input === undefined)
        return undefined;
      // Handle actual boolean values
      return !!input;
    }

    if (z.schema.isNumber(schema)) {
      const num = Number(input);
      return Number.isNaN(num) ? null : num;
    }

    if (z.schema.isString(schema)) {
      const format = z.schema.format(schema);
      if (format === "date" || format === "time" || format === "date-time") {
        // A cleared native date/time input emits "" — treat it (and any
        // unparseable value) as unset instead of throwing on toISOString().
        if (input === "") return undefined;
        const date =
          format === "time" ? new Date(`1970-01-01T${input}`) : new Date(input);
        if (Number.isNaN(date.getTime())) return undefined;
        if (format === "date") return date.toISOString().slice(0, 10); // For date input
        if (format === "time") return date.toISOString().slice(11, 16); // For time input
        return date.toISOString(); // For datetime-local input
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

/**
 * An array field.
 *
 * `items` is intentionally always `[]` at model level: the model does not know
 * how many rows exist, so the UI builds the per-row fields itself. The
 * property is still present and always an array so consumers can
 * `field.items.map(...)` without a null check — `useForm.browser.spec.tsx`
 * pins exactly that. Review #3 read it as a "permanently empty typed surface"
 * and proposed removing it; the test is what says otherwise.
 */
export interface ArrayInputField<T extends TSchema> extends BaseInputField {
  items: Array<InputField<T>>;
}

export type InputHTMLAttributesLike = Pick<
  InputHTMLAttributes<unknown>,
  | "id"
  | "name"
  | "type"
  | "value"
  | "defaultValue"
  | "defaultChecked"
  | "required"
  | "maxLength"
  | "minLength"
  | "aria-label"
> & {
  value?: any;
  defaultValue?: any;

  /**
   * Writes the control's value back into the form model. Spreading `props`
   * onto an `<input>` is enough to make it a working, uncontrolled field.
   */
  onChange?: (event: ChangeEvent<HTMLInputElement>) => void;
};

export type FormCtrlOptions<T extends TObject> = {
  /**
   * The schema defining the structure and validation rules for the form.
   * This should be a Zod schema object.
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
   * Prefix for the generated field IDs and `data-testid` attributes.
   *
   * > "username" with id="form-123" will become "form-123-username".
   *
   * If omitted, a unique ID is generated automatically (via `useId()`), so
   * field IDs and test IDs always exist.
   */
  id?: string;

  onError?: (error: Error) => void;

  onChange?: (key: string, value: any, store: Record<string, any>) => void;

  onReset?: () => void;
};
