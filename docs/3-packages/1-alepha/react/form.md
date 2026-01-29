# Alepha - React Form

## Installation

Part of the `alepha` package. Import from `alepha/react/form`.

```bash
npm install alepha
```

## Overview

| type | quality | stability |
|------|---------|-----------|
| frontend | rare | stable |

Type-safe forms with validation.

**Features:**
- Form state management
- TypeBox schema validation
- Field-level error handling
- Submit handling with loading state
- Form reset

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
  <form {...form.props}>
    <input {...form.input.username.props} />
    <input {...form.input.password.props} />
    <button type="submit">Submit</button>
  </form>
);
```
