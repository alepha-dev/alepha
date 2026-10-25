# @alepha/ui - Tree

## Installation

```bash
npm install @alepha/ui
```

## Overview

A controlled tree.

`treeModel`'s functions are the pure half: build, flatten, cycle-safe parents
and drop resolution. `TreeView` draws the rows with their indent guides and
ARIA tree roles; drag and drop, inline rename and a context-menu slot are
opt-ins. `useTreeState` holds the gesture state and `TreeViewResizer` is the
pane handle.

## API Reference

### React Hooks

- [`useTreeState`](/docs/reference-react-hooks-usetreestate) - The state a `TreeView` needs and a consumer would otherwise write again:
