# Forms

Alepha provides `useForm` for schema-driven forms with TypeBox validation, automatic input generation, and lifecycle events.

## Basic Usage

```typescript
import { z } from "alepha";
import { useForm } from "alepha/react/form";

function LoginForm() {
  const form = useForm({
    schema: z.object({
      email: z.email(),
      password: z.text(),
    }),
    handler: async (values) => {
      await api.login(values);
    },
  });

  return (
    <form {...form.props}>
      <input {...form.input.email.props} />
      <input {...form.input.password.props} type="password" />
      <button type="submit">Login</button>
    </form>
  );
}
```

Spread `form.props` on the `<form>` element and `form.input.<field>.props` on each input. The props include `name`, `type`, `onChange`, `required`, `defaultValue`, and other attributes derived from the schema.

## useForm Options

| Option          | Type                                | Description                                      |
|-----------------|-------------------------------------|--------------------------------------------------|
| `schema`        | `TObject`                           | TypeBox schema defining fields and validation.   |
| `handler`       | `(values, { form }) => unknown`     | Called on submit with validated values.           |
| `initialValues` | `Partial<Static<T>>`               | Pre-populate fields with existing data.          |
| `id`            | `string`                            | Prefix for field IDs and `data-testid` attributes. |
| `onChange`      | `(key, value, store) => void`       | Called on every field change.                    |
| `onError`       | `(error, { form }) => void`         | Called when submission throws an error.          |
| `onReset`       | `() => void`                        | Called when the form is reset.                   |
| `onCreateField` | `(name, schema) => InputHTMLAttributes` | Customize generated input attributes.        |

The second argument to `useForm` is a dependency array (defaults to `[]`). When dependencies change, the form is re-created.

## FormModel

`useForm` returns a `FormModel<T>` instance with the following API:

### form.props

Spread on the `<form>` element. Includes:

- `id` -- unique form identifier
- `noValidate` -- set to `true` (validation is handled by the schema)
- `onSubmit` -- calls `form.submit()` with `preventDefault`
- `onReset` -- calls `form.reset()`

### form.input

A proxy object where each key corresponds to a schema property. Each field has:

| Property   | Type                        | Description                                 |
|------------|-----------------------------|---------------------------------------------|
| `props`    | `InputHTMLAttributes`       | Spread on the `<input>` element.            |
| `path`     | `string`                    | JSON pointer path (e.g., `/email`).         |
| `required` | `boolean`                   | Whether the field is required.              |
| `schema`   | `TSchema`                   | The TypeBox schema for this field.          |
| `set`      | `(value: any) => void`      | Programmatically set the field value.       |
| `form`     | `FormModel`                 | Reference back to the parent form.          |

### form.submit()

Triggers form submission programmatically. Validates values against the schema, then calls the `handler`. Prevents concurrent submissions.

### form.reset(event)

Clears all form values and emits a `form:reset` event.

### form.currentValues

Returns the current form values as a restructured object (nested keys like `address.city` become `{ address: { city: ... } }`).

### form.submitting

Boolean indicating if a submission is in progress.

## Automatic Type Detection

Input types are automatically inferred from the schema:

| Schema Type      | Input Type       |
|------------------|------------------|
| `z.integer()`    | `number`         |
| `z.number()`     | `number`         |
| `z.boolean()`    | `checkbox`       |
| `z.email()`      | `email`          |
| `z.text()`       | `text`           |
| Field named `password` | `password`  |
| Field named `url` | `url`           |
| `z.date()`       | `date`           |
| `z.time()`       | `time`           |
| `z.datetime()`   | `datetime-local` |
| `z.file()`       | `file`           |

String constraints like `maxLength` and `minLength` are also applied to the input attributes.

## Nested Object Fields

For schemas with nested objects, use `items` to access child fields:

```typescript
const form = useForm({
  schema: z.object({
    address: z.object({
      street: z.text(),
      city: z.text(),
    }),
  }),
  handler: async (values) => { /* values.address.street, values.address.city */ },
});

// Access nested fields:
<input {...form.input.address.items.street.props} />
<input {...form.input.address.items.city.props} />
```

## Tracking Form State

Use `useFormState` to reactively track loading, dirty, error, and value states:

```typescript
import { useFormState } from "alepha/react/form";

function MyForm() {
  const form = useForm({ /* ... */ });
  const { loading, dirty, error } = useFormState(form);

  return (
    <form {...form.props}>
      {/* inputs */}
      {error && <p>{error.message}</p>}
      <button type="submit" disabled={loading || !dirty}>
        {loading ? "Saving..." : "Save"}
      </button>
    </form>
  );
}
```

**useFormState options:**

The first argument is the form model (or `{ form, path }` to track a specific field). The second argument is an array of keys to track:

```typescript
// Track only loading and error
const { loading, error } = useFormState(form, ["loading", "error"]);

// Track a specific field's error
const { error } = useFormState({ form, path: "/email" }, ["error"]);

// Track current values
const { values } = useFormState(form, ["values"]);
```

**Return type:**

| Property  | Type                  | Description                          |
|-----------|-----------------------|--------------------------------------|
| `loading` | `boolean`             | True during form submission.         |
| `dirty`   | `boolean`             | True after any field change. Resets on successful submit. |
| `error`   | `Error \| undefined`  | Error from the last failed submit.   |
| `values`  | `Record \| undefined` | Current form values (updated on change and submit). |

## Form Events

Forms emit events on the Alepha event system:

| Event                 | Payload                          | Description                    |
|-----------------------|----------------------------------|--------------------------------|
| `form:change`         | `{ id, path, value }`           | A field value changed.         |
| `form:reset`          | `{ id, values }`                | Form was reset.                |
| `form:submit:begin`   | `{ id }`                        | Submission started.            |
| `form:submit:success` | `{ id, values }`                | Submission succeeded.          |
| `form:submit:error`   | `{ id, error }`                 | Submission failed.             |
| `form:submit:end`     | `{ id }`                        | Submission finished (always).  |

Forms also emit `react:action:begin`, `react:action:success`, `react:action:error`, and `react:action:end` events with `type: "form"`, so global action handlers apply to form submissions too.

## FormValidationError

Throw a `FormValidationError` in your handler to report field-level validation errors:

```typescript
import { FormValidationError } from "alepha/react/form";

handler: async (values) => {
  const exists = await api.checkEmail(values.email);
  if (exists) {
    throw new FormValidationError({
      message: "Email already in use",
      path: "/email",
    });
  }
}
```

The `path` is a JSON pointer matching the field path (e.g., `/email`, `/address/city`).
