# Alepha - React Form

## Installation

Part of the `alepha` package. Import from `alepha/react/form`.

```bash
npm install alepha
```

## Overview

Type-safe forms with validation.

**Features:**

- Form state management
- Zod schema validation
- Field-level error handling
- Submit handling with loading state
- Form reset

## API Reference

### React Hooks

- [`useFieldValue`](/docs/reference-react-hooks-usefieldvalue) - Hook to subscribe to a single form field's value.
- [`useForm`](/docs/reference-react-hooks-useform) - Custom hook to create a form with validation and field management.
- [`useFormQuerySync`](/docs/reference-react-hooks-useformquerysync) - Two-way bind a `useForm` instance to the URL query params, keyed
- [`useFormState`](/docs/reference-react-hooks-useformstate) - Tracks whichever `form` the caller currently passes in, not only the one
- [`useFormValues`](/docs/reference-react-hooks-useformvalues) - Hook to subscribe to all form values.
