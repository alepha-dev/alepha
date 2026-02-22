# @alepha/ui - Core

UI components and themes for Alepha framework based on Mantine UI library.

## Installation

```bash
npm install @alepha/ui
```

## Overview

Core UI components based on Mantine UI v8.

**Features:**
- Mantine integration with theme support
- ActionButton, BurgerButton, ClipboardButton, DarkModeButton, LanguageButton, ThemeButton
- AlertDialog, ConfirmDialog, PromptDialog
- Form controls: Control, ControlArray, ControlDate, ControlNumber, ControlObject, ControlSelect, ControlQueryBuilder
- TypeForm for automatic form generation from TypeBox schemas
- DashboardShell layout component
- AppBar with configurable elements
- Sidebar navigation with sections and menu items
- Omnibar for command palette / search
- DataTable with filtering, sorting, pagination
- Toast notifications
- Theme system with dark mode

## API Reference

### Primitives

- [`$ui`](/docs/reference-primitives-$ui) — Convenience function to configure and inject the UiRouter.

### React Hooks

- [`useDialog`](/docs/reference-react-hooks-usedialog) — Use this hook to access the Dialog Service for showing various dialog types.
- [`useTheme`](/docs/reference-react-hooks-usetheme) — Hook to get and set the current theme.
- [`useToast`](/docs/reference-react-hooks-usetoast) — Use this hook to access the Toast Service for showing notifications.
