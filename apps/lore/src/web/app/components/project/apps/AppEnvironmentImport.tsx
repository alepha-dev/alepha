import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  useToast,
} from "@alepha/ui";
import { Control } from "@alepha/ui/form";
import { z } from "alepha";
import { useAction, useClient } from "alepha/react";
import { useForm, useFormValues } from "alepha/react/form";
import { useI18n } from "alepha/react/i18n";
import type { DragEvent } from "react";

import type { AppSecretController } from "@/api/controllers/AppSecretController.ts";

import { DotenvParser } from "../../../services/DotenvParser.ts";
import type { I18n } from "../../../services/I18n.ts";

export interface AppEnvironmentImportProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: number;
  instanceId: string;
  /**
   * The names already set, so the preview can say "replaced" rather than
   * "new".
   */
  taken: string[];
  /**
   * The names this copy refuses, from the list response. The server refuses
   * them on its own; this only flags them before the click.
   */
  reserved: string[];
}

/**
 * Import a `.env` into a copy's environment (#Q2468).
 *
 * Paste the text, or drop a file onto the field. The preview lists every key
 * as **new**, **replaced** or **refused** (a reserved name, an invalid name, a
 * line that does not parse, with its line number), and one Import button
 * sends the new and replaced keys in ONE request, which the server applies
 * all or nothing.
 *
 * Whether each key is stored as a secret or a variable is the server's call,
 * from the app's declaration, exactly as for a single set.
 */
const AppEnvironmentImport = (props: AppEnvironmentImportProps) => {
  const { tr } = useI18n<I18n, "en">();
  const toaster = useToast();
  const secretApi = useClient<AppSecretController>();

  const form = useForm({
    id: "app-environment-import",
    schema: z.object({ text: z.string().max(200_000) }),
    initialValues: { text: "" },
    handler: async () => {},
  });
  const text = String(useFormValues(form).text ?? "");

  const parsed = DotenvParser.parse(text);
  const taken = new Set(props.taken);
  const reserved = new Set(props.reserved);
  const rows = parsed.entries.map((entry) => {
    const key = entry.key.toUpperCase();
    const status: "new" | "replaced" | "refused" = !/^[A-Z][A-Z0-9_]*$/.test(
      key,
    )
      ? "refused"
      : reserved.has(key) || !entry.value
        ? "refused"
        : taken.has(key)
          ? "replaced"
          : "new";
    const reason =
      status !== "refused"
        ? undefined
        : !/^[A-Z][A-Z0-9_]*$/.test(key)
          ? tr("app.environment.import.invalidName")
          : !entry.value
            ? tr("app.environment.import.emptyValue")
            : tr("app.environment.import.reserved");
    return { ...entry, key, status, reason };
  });
  const sendable = rows.filter((row) => row.status !== "refused");

  const importAction = useAction<[], boolean>(
    {
      handler: async () => {
        await secretApi.importAppSecrets({
          params: { projectId: props.projectId, instanceId: props.instanceId },
          body: {
            entries: sendable.map((row) => ({
              key: row.key,
              value: row.value,
            })),
          },
        });
        toaster.success(
          tr("app.environment.import.done", {
            args: [String(sendable.length)],
          }),
        );
        form.reset();
        props.onOpenChange(false);
        return true;
      },
      invalidates: [["app-secrets", props.projectId, props.instanceId]],
    },
    [secretApi, sendable, props.projectId, props.instanceId, toaster, tr],
  );

  // A dropped file fills the field with its text; the drop never navigates.
  const onDrop = (event: DragEvent<HTMLElement>) => {
    const file = event.dataTransfer.files?.[0];
    if (!file) {
      return;
    }
    event.preventDefault();
    void file.text().then((content) => form.input.text.set(content));
  };

  return (
    <Dialog
      open={props.open}
      onOpenChange={(open) => {
        if (!open) form.reset();
        props.onOpenChange(open);
      }}
    >
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{tr("app.environment.import.title")}</DialogTitle>
          <DialogDescription>
            {tr("app.environment.import.description")}
          </DialogDescription>
        </DialogHeader>

        <Control
          input={form.input.text}
          area
          rows={10}
          placeholder={"STRIPE_SECRET_KEY=sk_live_...\nPUBLIC_URL=https://..."}
          inputProps={{
            className: "font-mono text-xs",
            onDragOver: (event: DragEvent<HTMLElement>) =>
              event.preventDefault(),
            onDrop,
            "data-testid": "app-environment-import-text",
          }}
        />

        {rows.length > 0 || parsed.errors.length > 0 ? (
          <ul
            className="flex max-h-56 flex-col gap-1 overflow-y-auto text-xs"
            data-testid="app-environment-import-preview"
          >
            {rows.map((row) => (
              <li key={row.key} className="flex items-center gap-2">
                <Badge
                  variant={row.status === "refused" ? "destructive" : "tint"}
                >
                  {row.status === "new"
                    ? tr("app.environment.import.new")
                    : row.status === "replaced"
                      ? tr("app.environment.import.replaced")
                      : tr("app.environment.import.refused")}
                </Badge>
                <span className="font-mono">{row.key}</span>
                <span className="text-muted-foreground">
                  {tr("app.environment.import.line", {
                    args: [String(row.line)],
                  })}
                  {row.reason ? ` - ${row.reason}` : ""}
                  {parsed.duplicates.includes(row.key)
                    ? ` - ${tr("app.environment.import.duplicate")}`
                    : ""}
                </span>
              </li>
            ))}
            {parsed.errors.map((error) => (
              <li
                key={`error-${error.line}`}
                className="flex items-center gap-2"
              >
                <Badge variant="destructive">
                  {tr("app.environment.import.refused")}
                </Badge>
                <span className="text-muted-foreground">
                  {tr("app.environment.import.line", {
                    args: [String(error.line)],
                  })}{" "}
                  -{" "}
                  {tr(
                    error.reason === "unterminated"
                      ? "app.environment.import.unterminated"
                      : "app.environment.import.syntax",
                  )}
                </span>
              </li>
            ))}
          </ul>
        ) : null}

        <DialogFooter>
          <Button
            type="button"
            variant="outlined"
            onClick={() => props.onOpenChange(false)}
          >
            {tr("app.environment.import.cancel")}
          </Button>
          <Button
            type="button"
            disabled={sendable.length === 0 || importAction.loading}
            onClick={() => void importAction.run()}
            data-testid="app-environment-import-submit"
          >
            {tr("app.environment.import.submit", {
              args: [String(sendable.length)],
            })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default AppEnvironmentImport;
