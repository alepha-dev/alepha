import { FolioCsv } from "@alepha/lore/csv";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  cn,
  textLinkUnderlineClassName,
} from "@alepha/ui";
import { Control } from "@alepha/ui/form";
import { currentProjectAtom, type I18n, loreDocsUrl } from "@lore/core/web";
import { z } from "alepha";
import { useAction, useClient, useStore } from "alepha/react";
import { useForm, useFormValues } from "alepha/react/form";
import { useI18n } from "alepha/react/i18n";
import { useRouter } from "alepha/react/router";
import { type ReactElement, useState } from "react";

import type { FolioController } from "../../../../../../api/controllers/FolioController.ts";
import type { FolioTableController } from "../../../../../../api/controllers/FolioTableController.ts";
import type { FolioColumnResource } from "../../../../../../api/schemas/folioColumnResourceSchema.ts";
import { userFoliosAtom } from "../../../../atoms/userFoliosAtom.ts";
import FolioCsvTypeSelect, {
  type FolioCsvGuessedType,
} from "./FolioCsvTypeSelect.tsx";

/**
 * Where an import lands: a new table folio (in a directory, or the root), or
 * the rows of an open one.
 */
export type FolioCsvImportTarget =
  | { kind: "new"; directoryId?: string }
  | { kind: "into"; folioId: string; columns: FolioColumnResource[] };

export interface FolioCsvImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  target: FolioCsvImportTarget;
  /**
   * A file dropped on the tree: the dialog opens on its preview.
   */
  file?: File;
  /**
   * After rows of an open table were imported: the grid re-reads.
   */
  onImported?: () => void;
}

type GuessedType = FolioCsvGuessedType;

/**
 * CSV into Lore (#E144, #Q3517): a new table folio named after the file, or
 * rows appended to an open table whose column names the header matches.
 *
 * The file is parsed here, in the browser, by the module the CLI uses
 * (`@alepha/lore/csv`), so a file one exports the other imports unchanged.
 * A preview shows the first 20 rows and the type guessed for each column,
 * which the person can change before anything is written. A file over the
 * caps is refused before any write. Rows go in batches of 100 with a
 * progress line; a failure names the line of the file it stopped at, and
 * what was imported before it stays.
 */
const FolioCsvImportDialog = (
  props: FolioCsvImportDialogProps,
): ReactElement => {
  const { tr } = useI18n<I18n, "en">();
  const [project] = useStore(currentProjectAtom);
  const [folios, setFolios] = useStore(userFoliosAtom);
  const folioApi = useClient<FolioController>();
  const tableApi = useClient<FolioTableController>();
  const router = useRouter();
  const csv = new FolioCsv();

  const [parsed, setParsed] = useState<
    { name: string; rows: string[][] } | undefined
  >(undefined);
  const [types, setTypes] = useState<GuessedType[]>([]);
  const [progress, setProgress] = useState<string | undefined>(undefined);
  const [failure, setFailure] = useState<string | undefined>(undefined);
  const [seenFile, setSeenFile] = useState<File | undefined>(undefined);

  const read = async (file: File) => {
    const text = await file.text();
    const rows = csv.parse(text).rows;
    setParsed({ name: file.name, rows });
    setFailure(undefined);
    setProgress(undefined);
    const width = Math.max(0, ...rows.map((row) => row.length));
    setTypes(
      Array.from({ length: width }, (_, index) =>
        csv.guessType(rows.slice(1).map((row) => row[index] ?? "")),
      ),
    );
  };

  // A dropped file opens the dialog on its preview.
  if (props.file && props.file !== seenFile) {
    setSeenFile(props.file);
    void read(props.file);
  }

  const form = useForm({
    schema: z.object({ file: z.any().optional(), header: z.boolean() }),
    initialValues: { header: true },
    handler: async () => {},
  });
  const header = useFormValues(form).header !== false;

  const rows = parsed?.rows ?? [];
  const headerRow = header
    ? (rows[0] ?? [])
    : (rows[0] ?? []).map((_, index) => `Column ${index + 1}`);
  const body = header ? rows.slice(1) : rows;
  const names = headerRow.map((name, index) => {
    const base = name.trim() || `Column ${index + 1}`;
    const earlier = headerRow
      .slice(0, index)
      .filter(
        (it) => (it.trim() || "").toLowerCase() === base.toLowerCase(),
      ).length;
    return earlier ? `${base} (${earlier + 1})` : base;
  });

  const overCaps = body.length > 2000 || names.length > 50;
  const matched =
    props.target.kind === "into"
      ? names.map(
          (name) =>
            (props.target as { columns: FolioColumnResource[] }).columns.find(
              (column) => column.name.toLowerCase() === name.toLowerCase(),
            )?.name,
        )
      : names;
  const skipped = names.filter((_, index) => !matched[index]);

  const importAction = useAction<[], void>(
    {
      handler: async () => {
        if (!project || !parsed) return;
        let folioId: string;
        let shortId: number | undefined;
        if (props.target.kind === "new") {
          const created = await folioApi.create({
            body: {
              projectId: project.id,
              title: parsed.name.replace(/\.csv$/i, "") || "Import",
              type: "table",
              columns: names.map((name, index) => ({
                name,
                type: types[index] ?? "text",
                ...(types[index] === "date" &&
                csv.hasTime(body.map((row) => row[index] ?? ""))
                  ? { options: { withTime: true } }
                  : {}),
              })),
              ...(props.target.directoryId
                ? { directoryId: props.target.directoryId }
                : {}),
            },
          });
          setFolios([created, ...folios]);
          folioId = created.id;
          shortId = created.shortId;
        } else {
          folioId = props.target.folioId;
        }

        let done = 0;
        for (let start = 0; start < body.length; start += 100) {
          const batch = body.slice(start, start + 100).map((line) => {
            const cells: Record<string, string> = {};
            matched.forEach((name, index) => {
              const value = line[index] ?? "";
              if (name && value !== "") cells[name] = value;
            });
            return { cells };
          });
          try {
            const answer = await tableApi.addFolioRows({
              params: { id: folioId },
              body: { rows: batch },
            });
            done += answer.rows.length;
            setProgress(
              tr("folios.table.import.progress", {
                args: [String(done), String(body.length)],
              }),
            );
          } catch (error) {
            setFailure(
              tr("folios.table.import.failed", {
                args: [
                  String(start + (header ? 2 : 1)),
                  error instanceof Error ? error.message : String(error),
                  String(done),
                ],
              }),
            );
            return;
          }
        }
        props.onImported?.();
        props.onOpenChange(false);
        setParsed(undefined);
        if (shortId !== undefined) {
          await router.push(
            router.path("projectFoliosFolio", {
              params: { projectSlug: project.slug, shortId },
            }),
          );
        }
      },
      // A failure is shown in the dialog, with the line it stopped at.
      onError: () => {},
    },
    [project, parsed, names, types, body, matched, header, folios],
  );

  const choices: GuessedType[] = ["text", "number", "date", "checkbox"];

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>
            {props.target.kind === "new"
              ? tr("folios.table.import.title-new")
              : tr("folios.table.import.title-into")}
          </DialogTitle>
          <DialogDescription>
            {tr("folios.table.import.description")}{" "}
            <a
              href={loreDocsUrl("remember-tables")}
              target="_blank"
              rel="noreferrer"
              className={cn(
                textLinkUnderlineClassName,
                "hover:text-foreground",
              )}
            >
              {tr("folios.table.docs")}
            </a>
          </DialogDescription>
        </DialogHeader>

        <div className="flex min-w-0 flex-col gap-3">
          {/* The file is read from the input's own change event, which
              bubbles here: the form keeps no copy of a File. */}
          {}
          <div
            onChange={(event) => {
              const target = event.target as HTMLInputElement;
              const file =
                target.type === "file" ? target.files?.[0] : undefined;
              if (file) void read(file);
            }}
          >
            <Control
              input={form.input.file}
              file
              accept=".csv,text/csv"
              label={tr("folios.table.import.file")}
            />
          </div>
          <Control
            input={form.input.header}
            label={tr("folios.table.import.header")}
          />

          {parsed && overCaps && (
            <p className="text-destructive text-sm">
              {tr("folios.table.import.over-caps", {
                args: [String(body.length), String(names.length)],
              })}
            </p>
          )}
          {parsed && props.target.kind === "into" && skipped.length > 0 && (
            <p className="text-muted-foreground text-sm">
              {tr("folios.table.import.skipped", {
                args: [skipped.join(", ")],
              })}
            </p>
          )}

          {parsed && !overCaps && (
            <div className="border-border max-h-80 overflow-auto rounded-md border text-xs">
              <table className="w-full border-collapse">
                <thead className="bg-muted/40 sticky top-0">
                  <tr>
                    {names.map((name, index) => (
                      <th key={name} className="px-2 py-1 text-start align-top">
                        <div className="font-medium">{name}</div>
                        {props.target.kind === "new" && (
                          <FolioCsvTypeSelect
                            value={types[index] ?? "text"}
                            choices={choices}
                            label={tr("folios.table.import.type-of", {
                              args: [name],
                            })}
                            onChange={(type) =>
                              setTypes((current) =>
                                current.map((it, i) =>
                                  i === index ? type : it,
                                ),
                              )
                            }
                          />
                        )}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {body.slice(0, 20).map((line, r) => (
                    // A preview row has no identity but its place in the file.
                    <tr key={r} className="border-border border-t">
                      {names.map((name, c) => (
                        <td key={name} className="truncate px-2 py-1">
                          {line[c] ?? ""}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {progress && <p className="text-sm">{progress}</p>}
          {failure && <p className="text-destructive text-sm">{failure}</p>}
        </div>

        <DialogFooter>
          <Button
            variant="minimal"
            onClick={() => props.onOpenChange(false)}
            disabled={importAction.loading}
          >
            {tr("folios.table.import.cancel")}
          </Button>
          <Button
            onClick={() => void importAction.run()}
            disabled={!parsed || overCaps || body.length === 0}
            loading={importAction.loading}
          >
            {tr("folios.table.import.submit", {
              args: [String(body.length)],
            })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default FolioCsvImportDialog;
