# Alepha React Form

Manages form state and validation in React applications.

## Installation

This package is part of the Alepha framework and can be installed via the all-in-one package:

```bash
npm install alepha
```

## Module

React hooks for managing forms in Alepha applications.

This module provides a set of hooks to simplify form handling, validation, and submission in React applications built with Alepha.

It includes:
- `useForm`: A hook for managing form state, validation, and submission.

This module can be imported and used as follows:

```typescript
import { Alepha, run } from "alepha";
import { AlephaReactForm } from "alepha/react/form";

const alepha = Alepha.create()
	.with(AlephaReactForm);

run(alepha);
```

## API Reference

### Hooks

Hooks provide a way to tap into various lifecycle events and extend functionality. They follow the convention of starting with `use` and return configured hook instances.

#### useForm()

Custom hook to create a form with validation and field management.
This hook uses TypeBox schemas to define the structure and validation rules for the form.
It provides a way to handle form submission, field creation, and value management.

```tsx
import { t } from "alepha";

const form = useForm({
  schema: t.object({
    username: t.text(),
    password: t.text(),
  }),
  handler: (values) => {
    console.log("Form submitted with values:", values);
  },
});

return (
  <form onSubmit={form.onSubmit}>
    <input {...form.input("username")} />
    <input {...form.input("password")} />
    <button type="submit">Submit</button>
  </form>
);
```
