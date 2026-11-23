# @alepha/ui - Sortable

## Installation

```bash
npm install @alepha/ui
```

## Overview

Sortable lists, on `@dnd-kit`.

`useSortableList` holds a vertical list reordered by dragging (pointer or
touch) or from the keyboard: the order shown between a drop and the
server's answer, the drop index, a vertical-only modifier, and the keyboard
move (Space picks up, the arrows move, Space or Enter drops, Escape puts
back) with its screen-reader announcements. `useSortableItem` is one item
of it. The look and the save stay the app's. Opt-in: nothing else in
`@alepha/ui` imports it, so `@dnd-kit` loads only with it.

## API Reference

### React Hooks

- [`useSortableItem`](/docs/reference-react-hooks-usesortableitem) - One item of a `useSortableList`: the element both dragged and dropped
- [`useSortableList`](/docs/reference-react-hooks-usesortablelist) - A vertical list reordered by dragging or from the keyboard, on `@dnd-kit`
