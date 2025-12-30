# @alepha/react - Form

## Installation

```bash
npm install @alepha/react
```

## Overview

React hooks for managing forms in Alepha applications.

This module provides a set of hooks to simplify form handling, validation, and submission in React applications built with Alepha.

It includes:
- `useForm`: A hook for managing form state, validation, and submission.

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
