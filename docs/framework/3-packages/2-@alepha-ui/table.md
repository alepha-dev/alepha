# @alepha/ui - Table

## Installation

```bash
npm install @alepha/ui
```

## Overview

Data tables.

`DataTable` is a table wired for server-side pagination, sorting and
filtering, with row and bulk actions, persisted filters and a static mode for
local data (`paginateLocal`). Its filters are a record of fields
(`DataTableFilterFields`) that it draws on its own filter bar.
`DataTableFilterMenu`, `DataTableFilterDialog` and `DataTableBulkMenu`
are its parts, and `useTableSelection` its selection state. `PermissionMatrix` is the grid of
roles against permissions the admin and account kits draw.

## API Reference

### React Hooks

- [`useTableSelection`](/docs/reference-react-hooks-usetableselection) - Cross-page row selection for DataTable.
