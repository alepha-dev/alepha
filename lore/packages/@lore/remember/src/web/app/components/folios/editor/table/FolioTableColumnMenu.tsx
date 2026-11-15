import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
  useDialog,
} from "@alepha/ui";
import type { I18n } from "@lore/core/web";
import { useI18n } from "alepha/react/i18n";
import { ArrowDown, ArrowUp, ChevronDown } from "lucide-react";
import type { ReactElement } from "react";

import type { FolioColumnOperation } from "../../../../../../api/schemas/folioColumnOperationSchema.ts";
import type { FolioColumnResource } from "../../../../../../api/schemas/folioColumnResourceSchema.ts";

export interface FolioTableColumnMenuProps {
  column: FolioColumnResource;
  index: number;
  count: number;
  readOnly: boolean;
  disabled?: boolean;
  sort?: "asc" | "desc";
  onSort: (direction: "asc" | "desc" | undefined) => void;
  onOperations: (operations: FolioColumnOperation[]) => void;
  /**
   * How many filled cells a retype would empty, asked before it is
   * confirmed.
   */
  retypePreview: (type: FolioColumnResource["type"]) => Promise<number>;
}

/**
 * A column's header and its menu (#Q3516): sort, rename, change type (told
 * first how many cells will read as empty), edit a select's options, move
 * left or right, delete. Sorting is the reader's and goes to the URL; every
 * other entry is a column operation and needs `folio:write`.
 */
const FolioTableColumnMenu = (
  props: FolioTableColumnMenuProps,
): ReactElement => {
  const { tr } = useI18n<I18n, "en">();
  const dialog = useDialog();
  const types: FolioColumnResource["type"][] = [
    "text",
    "number",
    "checkbox",
    "date",
    "select",
    "reference",
  ];

  const rename = async () => {
    const name = await dialog.prompt({
      title: tr("folios.table.column.rename"),
      label: tr("folios.table.column.name"),
      defaultValue: props.column.name,
      validate: (value) =>
        value.trim().length < 1 || value.trim().length > 80
          ? tr("folios.table.column.name-invalid")
          : null,
    });
    if (name && name.trim() !== props.column.name) {
      props.onOperations([
        { op: "rename", column: props.column.id, name: name.trim() },
      ]);
    }
  };

  const retype = async (type: FolioColumnResource["type"]) => {
    if (type === props.column.type) return;
    const lost = await props.retypePreview(type);
    const ok = await dialog.confirm({
      title: tr("folios.table.column.retype-title", {
        args: [props.column.name, tr(`folios.table.type.${type}`)],
      }),
      description:
        lost > 0
          ? tr("folios.table.column.retype-lost", { args: [String(lost)] })
          : tr("folios.table.column.retype-safe"),
      confirmLabel: tr("folios.table.column.retype-confirm"),
      destructive: lost > 0,
    });
    if (ok) {
      props.onOperations([{ op: "retype", column: props.column.id, type }]);
    }
  };

  const editOptions = async () => {
    const value = await dialog.prompt({
      title: tr("folios.table.column.options"),
      description: tr("folios.table.column.options-help"),
      defaultValue: (props.column.options.choices ?? [])
        .map((choice) => choice.label)
        .join(", "),
    });
    if (value === null) return;
    props.onOperations([
      {
        op: "setOptions",
        column: props.column.id,
        options: {
          choices: value
            .split(",")
            .map((label) => label.trim())
            .filter(Boolean),
        },
      },
    ]);
  };

  const remove = async () => {
    const ok = await dialog.confirm({
      title: tr("folios.table.column.delete-title", {
        args: [props.column.name],
      }),
      description: tr("folios.table.column.delete-body"),
      confirmLabel: tr("folios.table.column.delete"),
      destructive: true,
    });
    if (ok) props.onOperations([{ op: "remove", column: props.column.id }]);
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="minimal"
            size="sm"
            className="h-8 w-full justify-between rounded-none px-2 font-medium"
            disabled={props.disabled}
          />
        }
      >
        <span className="truncate">{props.column.name}</span>
        <span className="text-muted-foreground flex items-center gap-1">
          {props.sort === "asc" && <ArrowUp className="size-3" />}
          {props.sort === "desc" && <ArrowDown className="size-3" />}
          <ChevronDown className="size-3" />
        </span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuItem onClick={() => props.onSort("asc")}>
          {tr("folios.table.column.sort-asc")}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => props.onSort("desc")}>
          {tr("folios.table.column.sort-desc")}
        </DropdownMenuItem>
        {props.sort && (
          <DropdownMenuItem onClick={() => props.onSort(undefined)}>
            {tr("folios.table.column.sort-clear")}
          </DropdownMenuItem>
        )}
        {!props.readOnly && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => void rename()}>
              {tr("folios.table.column.rename")}
            </DropdownMenuItem>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                {tr("folios.table.column.type")}
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                {types.map((type) => (
                  <DropdownMenuItem
                    key={type}
                    disabled={type === props.column.type}
                    onClick={() => void retype(type)}
                  >
                    {tr(`folios.table.type.${type}`)}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            {props.column.type === "select" && (
              <DropdownMenuItem onClick={() => void editOptions()}>
                {tr("folios.table.column.options")}
              </DropdownMenuItem>
            )}
            <DropdownMenuItem
              disabled={props.index === 0}
              onClick={() =>
                props.onOperations([
                  {
                    op: "move",
                    column: props.column.id,
                    position: props.index - 1,
                  },
                ])
              }
            >
              {tr("folios.table.column.move-left")}
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={props.index >= props.count - 1}
              onClick={() =>
                props.onOperations([
                  {
                    op: "move",
                    column: props.column.id,
                    position: props.index + 1,
                  },
                ])
              }
            >
              {tr("folios.table.column.move-right")}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              variant="destructive"
              onClick={() => void remove()}
            >
              {tr("folios.table.column.delete")}
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

export default FolioTableColumnMenu;
