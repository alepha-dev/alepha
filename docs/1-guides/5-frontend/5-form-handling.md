# Form Handling

Forms are the tax you pay for user input.
Nobody enjoys building them.
Validation logic scattered across components, state management nightmares, error messages that appear in the wrong place...

Alepha's `useForm` hook makes forms almost bearable.

## Basic Usage

```tsx
import { useForm } from "alepha/react/form";
import { t } from "alepha";

const LoginForm = () => {
  const form = useForm({
    schema: t.object({
      email: t.email(),
      password: t.text({ minLength: 8 }),
    }),
    handler: async (values) => {
      // values is fully typed: { email: string, password: string }
      await api.login(values);
    },
  });

  return (
    <form {...form.props}>
      <input {...form.input.email.props} placeholder="Email" />
      <input {...form.input.password.props} type="password" placeholder="Password" />
      <button type="submit">Sign In</button>
    </form>
  );
};
```

That's it. Schema defines the shape. Handler runs on submit. TypeBox validates before the handler even sees the data.

## The Schema

Your schema is the source of truth. It defines:

- What fields exist
- What types they are
- Validation rules (min length, email format, etc.)

```typescript
const form = useForm({
  schema: t.object({
    username: t.text({ minLength: 3, maxLength: 20 }),
    email: t.email(),
    age: t.integer({ minimum: 18 }),
    bio: t.optional(t.longText()),
  }),
  handler: async (values) => {
    // TypeScript knows: { username: string, email: string, age: number, bio?: string }
  },
});
```

If validation fails, the form doesn't submit. The error appears on the field. No manual validation code needed.

## The Handler

The handler is an async function that receives validated values. If it throws, the form handles it.

```typescript
const router = useRouter<AppRouter>();
const auth = useAuth<AppAuth>();

const form = useForm({
  schema: t.object({
    email: t.email(),
    password: t.text(),
  }),
  handler: async (values) => {
    try {
      await auth.login(values.email, values.password);
      router.push("/dashboard");
    } catch (error) {
      // Re-throw to let the form handle it
      throw error;
    }
  },
});
```

### Field-Specific Errors

Sometimes the server tells you something's wrong with a specific field. Use `FormValidationError`:

```typescript
import { FormValidationError } from "alepha/react/form";
import { HttpError } from "alepha/server";

const form = useForm({
  schema: t.object({
    email: t.email(),
    password: t.text(),
  }),
  handler: async (values) => {
    try {
      await auth.login(values.email, values.password);
    } catch (error) {
      if (error instanceof HttpError && error.error === "InvalidCredentialsError") {
        // Show error on the password field
        throw new FormValidationError({
          message: "Invalid email or password",
          path: "/password",
        });
      }
      throw error;
    }
  },
});
```

The `path` uses JSON Pointer syntax. `/password` targets the password field. `/address/city` would target a nested field.

## Spreading Props

The magic is in the props. Spread them and everything works:

```typescript
// Form element
<form {...form.props}>

// Input fields
<input {...form.input.email.props} />
<input {...form.input.password.props} type="password" />
```

What's in those props?

- `form.props` — `onSubmit`, `onReset`, and form identification
- `form.input.fieldName.props` — `name`, `value`, `onChange`, `onBlur`, and validation state

You can add your own props after spreading:

```typescript
<input
  {...form.input.email.props}
  placeholder="you@example.com"
  className="my-input"
/>
```

## Tracking Form State

Need to know if the form is submitting? If it's been modified? Use `useFormState`:

```typescript
import { useForm } from "alepha/react/form";
import { useFormState } from "alepha/react/form";

const MyForm = () => {
  const form = useForm({
    schema: t.object({ name: t.text() }),
    handler: async (values) => { /* ... */ },
  });

  const { loading, dirty, error } = useFormState(form);

  return (
    <form {...form.props}>
      <input {...form.input.name.props} />

      <button type="submit" disabled={loading}>
        {loading ? "Saving..." : "Save"}
      </button>

      {dirty && <span>You have unsaved changes</span>}
      {error && <span className="error">{error.message}</span>}
    </form>
  );
};
```

### What useFormState Tracks

| Property | Type | Description |
|----------|------|-------------|
| `loading` | `boolean` | True while handler is executing |
| `dirty` | `boolean` | True if any field has changed |
| `error` | `Error \| undefined` | Last submission error |
| `values` | `object \| undefined` | Current form values |

You can pick which ones you need:

```typescript
// Only track loading state
const { loading } = useFormState(form, ["loading"]);

// Track everything
const { loading, dirty, error, values } = useFormState(form, ["loading", "dirty", "error", "values"]);
```

## Real-World Example

Here's a login form with all the bells and whistles:

```typescript
import { useForm, useFormState, FormValidationError } from "alepha/react/form";
import { useRouter } from "alepha/react/router";
import { t } from "alepha";
import { HttpError } from "alepha/server";

const LoginPage = () => {
  const router = useRouter();
  const auth = useAuth();

  const form = useForm({
    schema: t.object({
      identifier: t.string({ minLength: 1 }),
      password: t.string({ minLength: 6 }),
    }),
    handler: async (data) => {
      try {
        await auth.login({
          username: data.identifier,
          password: data.password,
        });
        await router.push("/");
      } catch (error) {
        if (error instanceof HttpError && error.error === "InvalidCredentialsError") {
          throw new FormValidationError({
            message: "Invalid credentials",
            path: "/password",
          });
        }
        throw error;
      }
    },
  });

  const { loading } = useFormState(form, ["loading"]);

  return (
    <form {...form.props}>
      <div>
        <label>Username or Email</label>
        <input {...form.input.identifier.props} autoComplete="username" />
      </div>

      <div>
        <label>Password</label>
        <input {...form.input.password.props} type="password" autoComplete="current-password" />
      </div>

      <button type="submit" disabled={loading}>
        {loading ? "Signing in..." : "Sign In"}
      </button>
    </form>
  );
};
```

## With @alepha/ui

If you're using the UI kit, forms get even cleaner:

```typescript
import { useForm } from "alepha/react/form";
import { ActionButton, Control } from "@alepha/ui";
import { IconUser, IconLock } from "@tabler/icons-react";
import { t } from "alepha";

const LoginForm = () => {
  const form = useForm({
    schema: t.object({
      email: t.email(),
      password: t.text({ minLength: 8 }),
    }),
    handler: async (values) => {
      await auth.login(values);
    },
  });

  return (
    <form {...form.props}>
      <Control
        title="Email"
        input={form.input.email}
        icon={IconUser}
      />
      <Control
        title="Password"
        input={form.input.password}
        icon={IconLock}
        password={{ autoComplete: "current-password" }}
      />
      <ActionButton variant="filled" form={form}>
        Sign In
      </ActionButton>
    </form>
  );
};
```

The `Control` component handles labels, icons, and error display. The `ActionButton` automatically disables during submission when you pass it the form.

### TypeForm: Zero-Layout Forms

Don't want to write any JSX for your form fields? `TypeForm` renders everything automatically from your schema:

```tsx
import { useForm } from "alepha/react/form";
import { TypeForm } from "@alepha/ui";
import { t } from "alepha";

const UserForm = () => {
  const form = useForm({
    schema: t.object({
      username: t.text({ title: "Username" }),
      email: t.email({ title: "Email Address" }),
      age: t.integer({ title: "Age", minimum: 0, maximum: 120 }),
      role: t.enum(["admin", "user", "guest"], { title: "Role", default: "user" }),
      subscribe: t.boolean({ title: "Subscribe to newsletter", default: false }),
    }),
    handler: async (values) => {
      await api.createUser(values);
    },
  });

  return <TypeForm form={form} columns={2} />;
};
```

That's the whole component. `TypeForm` inspects your schema and renders appropriate inputs for each field type. Strings get text inputs, integers get number inputs, booleans get checkboxes, enums get dropdowns. The `title` option in your schema becomes the field label.

#### Responsive Columns

Control the layout with the `columns` prop:

```tsx
// 2 columns on desktop
<TypeForm form={form} columns={2} />

// Responsive breakpoints
<TypeForm
  form={form}
  columns={{ xs: 1, sm: 2, lg: 3 }}
/>
```

#### Customizing Fields

Need to tweak specific fields? Use `fieldControlProps`:

```tsx
<TypeForm
  form={form}
  columns={2}
  fieldControlProps={{
    password: { password: { autoComplete: "new-password" } },
    bio: { textarea: { rows: 5 } },
  }}
/>
```

#### When to Use TypeForm

- **Prototyping** — Get a working form in seconds
- **Admin panels** — CRUD forms where design doesn't matter
- **Internal tools** — When "it works" beats "it's pretty"

For user-facing forms where you need pixel-perfect control, stick with `Control` and manual layout.
For everything else, `TypeForm` saves you from writing boilerplate.

## Tips

1. **Keep schemas simple** — Complex nested objects work, but flat forms are easier to manage
2. **Handle errors in the handler** — Transform API errors into `FormValidationError` for field-specific feedback
3. **Use `useFormState` sparingly** — Only subscribe to the state you actually need
4. **Trust the validation** — If the handler runs, the data is valid. Don't re-validate.

Forms still aren't fun. But at least now they're not painful.
