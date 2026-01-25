# @alepha/ui - Core

UI components and themes for Alepha framework based on Mantine UI library.

## Installation

```bash
npm install @alepha/ui
```

## Overview

| type | quality | stability |
|------|---------|-----------|
| frontend | rare | experimental |

Core UI components based on Mantine UI v8.

**Features:**
- Mantine integration with theme support
- ActionButton, BurgerButton, ClipboardButton, DarkModeButton, LanguageButton, ThemeButton
- AlertDialog, ConfirmDialog, PromptDialog
- Form controls: Control, ControlArray, ControlDate, ControlNumber, ControlObject, ControlSelect, ControlQueryBuilder
- TypeForm for automatic form generation from TypeBox schemas
- AdminShell layout component
- AppBar with configurable elements
- Sidebar navigation with sections and menu items
- Omnibar for command palette / search
- DataTable with filtering, sorting, pagination
- Toast notifications
- Theme system with dark mode

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

#### useTheme()

Hook to get and set the current theme.

Returns a tuple with the current theme and a function to set the theme.

```tsx
const [theme, setTheme] = useTheme();
```

#### useToast()

Use this hook to access the Toast Service for showing notifications.

```tsx
const toast = useToast();
toast.success({ message: "Operation completed successfully!" });
toast.error({ title: "Error", message: "Something went wrong" });
```
