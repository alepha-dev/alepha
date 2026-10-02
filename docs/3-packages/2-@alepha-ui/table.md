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
(`DataTableFilterFields`) that it draws on its own filter bar. Above that
bar it can hold a collapsible summary (`DataTableSummary`): stat cards
(`DataTableStatCard`) given or fetched with the table's filters, and any
node beside them. A `help` node sits behind a `?` at the end of the
toolbar's icons.
`DataTableFilterMenu`, `DataTableFilterDialog` and `DataTableBulkMenu`
are its parts, and `useTableSelection` its selection state. `PermissionMatrix` is the grid of
roles against permissions the admin and account kits draw.

## API Reference

### React Hooks

- [`useTableSelection`](/docs/reference-react-hooks-usetableselection) - Cross-page row selection for DataTable.
