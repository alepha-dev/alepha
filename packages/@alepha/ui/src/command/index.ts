/**
 * A command palette, on Base UI's `Autocomplete`.
 *
 * `Command`, `CommandDialog` and their parts. Data-driven: the root takes
 * `items` and ranks them against the query with cmdk's fuzzy scorer, ported,
 * and `CommandList` / `CommandGroup` draw what is left through a function
 * child. Opt-in: only the shell's spotlight imports it.
 *
 * @module alepha.ui.command
 */

export {
  Command,
  CommandDialog,
  type CommandDialogProps,
  CommandEmpty,
  type CommandEmptyProps,
  CommandGroup,
  type CommandGroupProps,
  CommandInput,
  type CommandInputProps,
  CommandItem,
  type CommandItemProps,
  CommandList,
  type CommandListProps,
  type CommandProps,
  CommandSeparator,
  type CommandSeparatorProps,
  CommandShortcut,
  type CommandShortcutProps,
} from "./Command.tsx";
export { commandScore } from "./commandScore.ts";
export type { CommandFilter, CommandItemGroup } from "./rankCommandItems.ts";
