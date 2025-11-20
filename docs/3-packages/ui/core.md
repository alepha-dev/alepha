# @alepha/ui - Core

UI components and themes for Alepha framework based on Mantine UI library.

## Installation

This module is part of the Alepha framework:

```bash
npm install @alepha/ui
```

## Overview

Mantine

## API Reference

### Hooks

Hooks provide a way to tap into various lifecycle events and extend functionality. They follow the convention of starting with `use` and return configured hook instances.

#### useDialog()

Use this hook to access the Dialog Service for showing various dialog types.

```tsx
const dialog = useDialog();
await dialog.alert({ title: "Alert", message: "This is an alert message" });
const confirmed = await dialog.confirm({ title: "Confirm", message: "Are you sure?" });
const input = await dialog.prompt({ title: "Input", message: "Enter your name:" });
```

#### useToast()

Use this hook to access the Toast Service for showing notifications.

```tsx
const toast = useToast();
toast.success({ message: "Operation completed successfully!" });
toast.error({ title: "Error", message: "Something went wrong" });
```
