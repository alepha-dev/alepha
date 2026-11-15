import { cn } from "@alepha/ui";
import { Control } from "@alepha/ui/form";
import type { DashboardFilterEditorProps, I18n } from "@lore/core/web";
import { z } from "alepha";
import { useStore } from "alepha/react";
import { useForm, useFormValues } from "alepha/react/form";
import { useI18n } from "alepha/react/i18n";
import { FileText, Table2 } from "lucide-react";
import type { ReactElement } from "react";

import { projectDirectoriesAtom } from "../../../atoms/projectDirectoriesAtom.ts";
import { userFoliosAtom } from "../../../atoms/userFoliosAtom.ts";

/**
 * The Folio card's filter step in the dashboard catalogue (#E144, #Q3520):
 * pick a folio from the project's, searchable by title and path, then what
 * to show of it, with only the choices that fit the folio picked. An
 * encrypted folio is not offered: a card cannot read it.
 */
const FolioCardFilterEditor = (
  props: DashboardFilterEditorProps,
): ReactElement => {
  const { tr } = useI18n<I18n, "en">();
  const [folios] = useStore(userFoliosAtom);
  const [directories] = useStore(projectDirectoriesAtom);
  const search = useForm({
    schema: z.object({ q: z.string() }),
    initialValues: { q: "" },
    keepDirty: false,
    handler: async () => {},
  });
  const q = String(useFormValues(search).q ?? "")
    .trim()
    .toLowerCase();

  const pathOf = (directoryId?: string): string => {
    const names: string[] = [];
    let cursor = directoryId;
    const seen = new Set<string>();
    while (cursor && !seen.has(cursor)) {
      seen.add(cursor);
      const dir = (directories ?? []).find((it) => it.id === cursor);
      if (!dir) break;
      names.unshift(dir.name);
      cursor = dir.parentId;
    }
    return names.join(" / ");
  };

  const options = (folios ?? [])
    .filter((folio) => !folio.protected)
    .map((folio) => ({ folio, path: pathOf(folio.directoryId) }))
    .filter(
      ({ folio, path }) =>
        !q ||
        folio.title.toLowerCase().includes(q) ||
        path.toLowerCase().includes(q),
    )
    .sort((a, b) =>
      `${a.path}/${a.folio.title}`.localeCompare(`${b.path}/${b.folio.title}`),
    );

  const picked = (folios ?? []).find(
    (folio) => folio.shortId === props.values.folio,
  );
  const shows =
    picked?.type === "table"
      ? (["auto", "rows", "upcoming"] as const)
      : (["auto", "note"] as const);
  const show = shows.includes(props.values.show as never)
    ? (props.values.show as string)
    : "auto";

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <div className="text-muted-foreground text-[10.5px] font-semibold tracking-[0.08em] uppercase">
          {tr("dashboard.filterField.folio")}
        </div>
        <Control
          input={search.input.q}
          label=""
          placeholder={tr("dashboard.folio.search")}
          inputProps={{ "aria-label": tr("dashboard.folio.search") }}
        />
        <div
          role="listbox"
          aria-label={tr("dashboard.filterField.folio")}
          className="border-border flex max-h-56 flex-col overflow-y-auto rounded-md border"
        >
          {options.length === 0 && (
            <div className="text-muted-foreground px-2.5 py-3 text-[11.5px]">
              {tr("dashboard.folio.none")}
            </div>
          )}
          {options.map(({ folio, path }) => {
            const on = folio.shortId === props.values.folio;
            const Icon = folio.type === "table" ? Table2 : FileText;
            return (
              <button
                key={folio.id}
                type="button"
                role="option"
                aria-selected={on}
                data-testid="dashboard-folio-option"
                onClick={() =>
                  props.onChange({
                    ...props.values,
                    folio: folio.shortId,
                    show: "auto",
                  })
                }
                className={cn(
                  "flex items-center gap-2 px-2.5 py-1.5 text-start text-[12.5px]",
                  on ? "bg-primary/10" : "hover:bg-hover",
                )}
              >
                <Icon className="text-muted-foreground size-3.5 shrink-0" />
                <span className="min-w-0 flex-1 truncate">{folio.title}</span>
                {path && (
                  <span className="text-muted-foreground max-w-32 shrink-0 truncate text-[11px]">
                    {path}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {picked && (
        <div className="flex flex-col gap-1.5">
          <div className="text-muted-foreground text-[10.5px] font-semibold tracking-[0.08em] uppercase">
            {tr("dashboard.filterField.show")}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {shows.map((option) => (
              <button
                key={option}
                type="button"
                data-testid="dashboard-filter-option"
                onClick={() =>
                  props.onChange({ ...props.values, show: option })
                }
                className={cn(
                  "h-7 rounded-full px-3 text-[11.5px] transition-colors",
                  show === option
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground hover:text-foreground",
                )}
              >
                {tr(`dashboard.filterValue.${option}`)}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default FolioCardFilterEditor;
