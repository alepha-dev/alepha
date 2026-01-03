# Forms

Forms. The thing we all pretend is simple until we need validation, error messages, loading states, and that weird edge case where the user submits twice.

The `@alepha/react/form` module gives you type-safe forms with validation baked in. Same schemas you use for your API? They validate your forms too.

## The `useForm` Hook

One hook to rule them all:

```tsx
import { useForm } from "@alepha/react/form";
import { t } from "alepha";

const CreateUserForm = () => {
  const form = useForm({
    schema: t.object({
      name: t.text({ minLength: 2 }),
      email: t.email(),
      age: t.integer({ minimum: 18 }),
    }),
    handler: async (values) => {
      await api.users.create(values);
    }
  });

  return (
    <form onSubmit={form.submit}>
      <input {...form.field("name")} placeholder="Name" />
      {form.errors.name && <span className="error">{form.errors.name}</span>}

      <input {...form.field("email")} placeholder="Email" />
      {form.errors.email && <span className="error">{form.errors.email}</span>}

      <input {...form.field("age")} type="number" placeholder="Age" />
      {form.errors.age && <span className="error">{form.errors.age}</span>}

      <button type="submit" disabled={form.loading}>
        {form.loading ? "Saving..." : "Create User"}
      </button>
    </form>
  );
};
```

That's it. Schema defines the shape, `form.field()` binds inputs, `form.errors` shows problems, `form.loading` tracks submission.

## Schema = Validation

Your TypeBox schema does double duty:

```typescript
const schema = t.object({
  // Text with constraints
  username: t.text({ minLength: 3, maxLength: 20 }),

  // Email validation built-in
  email: t.email(),

  // Numbers with ranges
  age: t.integer({ minimum: 18, maximum: 120 }),

  // Enums
  role: t.enum(["admin", "user", "guest"]),

  // Optional fields
  bio: t.optional(t.text({ maxLength: 500 })),

  // Nested objects
  address: t.object({
    street: t.text(),
    city: t.text(),
    zip: t.text({ pattern: "^\\d{5}$" }),
  }),

  // Arrays
  tags: t.array(t.text(), { minItems: 1, maxItems: 5 }),
});
```

Validation happens client-side before submission. The same schema validates server-side in your `$action`.

## Form API

### What `useForm` Returns

```typescript
const form = useForm({ schema, handler });

// Field binding
form.field("name")           // Returns { name, value, onChange, onBlur }
form.field("address.city")   // Nested paths work

// State
form.values                  // Current form values
form.errors                  // Validation errors by field
form.touched                 // Which fields have been touched
form.loading                 // True during submission
form.dirty                   // True if any field changed

// Actions
form.submit(event)           // Form onSubmit handler
form.reset()                 // Reset to initial values
form.setFieldValue(path, v)  // Programmatic update
form.setFieldTouched(path)   // Mark as touched
form.validate()              // Trigger validation manually
```

### Field Binding

The `field()` method returns props for standard inputs:

```tsx
// Text input
<input {...form.field("name")} />

// With type
<input {...form.field("email")} type="email" />

// Number
<input {...form.field("age")} type="number" />

// Checkbox
<input {...form.field("newsletter")} type="checkbox" />

// Textarea
<textarea {...form.field("description")} />
```

### Nested Fields

Use dot notation for nested objects:

```tsx
<input {...form.field("address.street")} placeholder="Street" />
<input {...form.field("address.city")} placeholder="City" />
<input {...form.field("address.zip")} placeholder="ZIP" />

{form.errors["address.zip"] && <span>{form.errors["address.zip"]}</span>}
```

### Array Fields

For arrays, use index notation:

```tsx
const TagsInput = () => {
  const tags = form.values.tags || [];

  return (
    <div>
      {tags.map((_, index) => (
        <input key={index} {...form.field(`tags.${index}`)} />
      ))}
      <button type="button" onClick={() => {
        form.setFieldValue("tags", [...tags, ""]);
      }}>
        Add Tag
      </button>
    </div>
  );
};
```

## Error Handling

Errors come in two flavors: field-level and form-level.

### Field Errors

Access via `form.errors`:

```tsx
{form.errors.email && (
  <span className="error">{form.errors.email}</span>
)}
```

### Form-Level Errors

Handle submission errors:

```tsx
const form = useForm({
  schema,
  handler: async (values) => {
    const result = await api.users.create(values);
    if (!result.success) {
      throw new Error(result.message);
    }
  },
});

// In JSX
{form.error && <div className="form-error">{form.error.message}</div>}
```

### Custom Error Messages

Customize via the schema:

```typescript
const schema = t.object({
  email: t.email({ errorMessage: "Please enter a valid email" }),
  age: t.integer({
    minimum: 18,
    errorMessage: {
      minimum: "You must be at least 18 years old"
    }
  }),
});
```

## Initial Values

Pre-fill the form:

```tsx
const form = useForm({
  schema,
  initialValues: {
    name: user.name,
    email: user.email,
    role: user.role,
  },
  handler: async (values) => {
    await api.users.update(user.id, values);
  },
});
```

### Dynamic Initial Values

Update when props change:

```tsx
const form = useForm({
  schema,
  initialValues: user,
  resetOnChange: [user.id], // Reset form when user.id changes
  handler: async (values) => {
    await api.users.update(user.id, values);
  },
});
```

## Validation Modes

Control when validation runs:

```tsx
const form = useForm({
  schema,
  validateOn: "blur",    // Validate on field blur (default)
  // validateOn: "change",  // Validate on every keystroke
  // validateOn: "submit",  // Only validate on submit
  handler: async (values) => { /* ... */ },
});
```

## Integrating with UI Libraries

### With Custom Input Components

```tsx
const TextInput = ({ name, label }) => {
  const form = useFormContext();
  const fieldProps = form.field(name);

  return (
    <div className="field">
      <label>{label}</label>
      <input {...fieldProps} />
      {form.errors[name] && <span className="error">{form.errors[name]}</span>}
    </div>
  );
};

// Usage
<form onSubmit={form.submit}>
  <FormProvider value={form}>
    <TextInput name="email" label="Email" />
    <TextInput name="password" label="Password" />
  </FormProvider>
</form>
```

### With Mantine/MUI

```tsx
import { TextInput, Button } from "@mantine/core";

const MyForm = () => {
  const form = useForm({
    schema: t.object({ email: t.email() }),
    handler: async (v) => { /* ... */ },
  });

  return (
    <form onSubmit={form.submit}>
      <TextInput
        label="Email"
        {...form.field("email")}
        error={form.errors.email}
      />
      <Button type="submit" loading={form.loading}>
        Submit
      </Button>
    </form>
  );
};
```

## Submit Behavior

### Preventing Double Submit

Forms automatically prevent double-submission. While `form.loading` is true, `form.submit` is a no-op.

### Disabling the Button

```tsx
<button type="submit" disabled={form.loading || !form.dirty}>
  {form.loading ? "Saving..." : "Save"}
</button>
```

### Success Callback

```tsx
const form = useForm({
  schema,
  handler: async (values) => {
    const created = await api.users.create(values);
    return created; // Returned to onSuccess
  },
  onSuccess: (result) => {
    toast.success("User created!");
    router.go("userProfile", { params: { id: result.id } });
  },
  onError: (error) => {
    toast.error(error.message);
  },
});
```

## Common Patterns

### Login Form

```tsx
const LoginForm = () => {
  const form = useForm({
    schema: t.object({
      email: t.email(),
      password: t.text({ minLength: 8 }),
      remember: t.optional(t.boolean()),
    }),
    handler: async (values) => {
      await auth.login(values.email, values.password, values.remember);
    },
    onSuccess: () => router.go("dashboard"),
  });

  return (
    <form onSubmit={form.submit}>
      <input {...form.field("email")} type="email" />
      <input {...form.field("password")} type="password" />
      <label>
        <input {...form.field("remember")} type="checkbox" />
        Remember me
      </label>
      <button type="submit" disabled={form.loading}>
        {form.loading ? "Logging in..." : "Login"}
      </button>
    </form>
  );
};
```

### Multi-Step Form

```tsx
const MultiStepForm = () => {
  const [step, setStep] = useState(1);

  const form = useForm({
    schema: t.object({
      // Step 1
      name: t.text(),
      email: t.email(),
      // Step 2
      company: t.text(),
      role: t.text(),
      // Step 3
      plan: t.enum(["free", "pro", "enterprise"]),
    }),
    handler: async (values) => {
      await api.onboard(values);
    },
  });

  const validateStep = async () => {
    const fieldsPerStep = {
      1: ["name", "email"],
      2: ["company", "role"],
      3: ["plan"],
    };
    const errors = await form.validateFields(fieldsPerStep[step]);
    return Object.keys(errors).length === 0;
  };

  const nextStep = async () => {
    if (await validateStep()) {
      setStep(step + 1);
    }
  };

  return (
    <form onSubmit={form.submit}>
      {step === 1 && (
        <>
          <input {...form.field("name")} />
          <input {...form.field("email")} />
          <button type="button" onClick={nextStep}>Next</button>
        </>
      )}
      {step === 2 && (
        <>
          <input {...form.field("company")} />
          <input {...form.field("role")} />
          <button type="button" onClick={() => setStep(1)}>Back</button>
          <button type="button" onClick={nextStep}>Next</button>
        </>
      )}
      {step === 3 && (
        <>
          <select {...form.field("plan")}>
            <option value="free">Free</option>
            <option value="pro">Pro</option>
            <option value="enterprise">Enterprise</option>
          </select>
          <button type="button" onClick={() => setStep(2)}>Back</button>
          <button type="submit">Complete</button>
        </>
      )}
    </form>
  );
};
```

## Quick Reference

```typescript
// Basic form
const form = useForm({
  schema: t.object({ ... }),
  handler: async (values) => { ... },
});

// With options
const form = useForm({
  schema,
  initialValues: { ... },
  validateOn: "blur",
  resetOnChange: [dependency],
  handler: async (values) => { ... },
  onSuccess: (result) => { ... },
  onError: (error) => { ... },
});

// Field binding
<input {...form.field("name")} />

// Errors
{form.errors.name && <span>{form.errors.name}</span>}

// Submit
<form onSubmit={form.submit}>
<button disabled={form.loading}>Submit</button>
```

---

Previous: [Head Management](./3-head.md) | Next: [i18n](./5-i18n.md)
