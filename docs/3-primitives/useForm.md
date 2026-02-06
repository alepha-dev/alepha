# useForm

> Custom hook to create a form with validation and field management.

## Import

```typescript
import { useForm } from "alepha/react/form";
```

## Overview

Custom hook to create a form with validation and field management.
This hook uses TypeBox schemas to define the structure and validation rules for the form.
It provides a way to handle form submission, field creation, and value management.

## Examples

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

