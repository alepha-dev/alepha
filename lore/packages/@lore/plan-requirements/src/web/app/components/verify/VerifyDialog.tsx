import {
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
import { currentProjectAtom, formatReference, type I18n } from "@lore/core/web";
import { z } from "alepha";
import { useClient, useQuery, useStore } from "alepha/react";
import { useForm, useFormValues } from "alepha/react/form";
import { useI18n } from "alepha/react/i18n";
import { Copy, Terminal, UserRound } from "lucide-react";

import type { PersonaController } from "../../../../api/controllers/PersonaController.ts";
import type { RequirementsPromptController } from "../../../../api/controllers/RequirementsPromptController.ts";
import type { PersonaResource } from "../../../../api/schemas/personaResourceSchema.ts";

/**
 * What the dialog verifies: a use case, a persona (all its use cases, or the
 * stale ones), every stale use case of the project, or a specification folio
 * to import.
 */
export type VerifySubject =
  | { kind: "usecase"; number: number }
  | { kind: "persona"; number: number }
  | { kind: "allStale" }
  | { kind: "import"; folioShortId?: number }
  | { kind: "draft"; requirement?: number; epic?: number };

export type VerifyMission = keyof typeof MISSION_LABEL_KEYS;

export interface VerifyDialogProps {
  subject: VerifySubject;
  /**
   * The mission the dialog opens on, when a menu already chose it
   * (`VerifyMenu`). Read at mount: key the dialog on it.
   */
  mission?: VerifyMission;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export const MISSIONS = {
  usecase: ["test", "spec", "demo"],
  persona: ["test", "explore"],
  allStale: ["test"],
  import: ["import"],
  draft: ["draft"],
} as const;

export const MISSION_LABEL_KEYS = {
  test: "requirements.verify.mission.test",
  spec: "requirements.verify.mission.spec",
  demo: "requirements.verify.mission.demo",
  explore: "requirements.verify.mission.explore",
  import: "requirements.verify.mission.import",
  draft: "requirements.verify.mission.draft",
} as const;

const KIND_OF = {
  test: "useCaseTest",
  spec: "useCaseSpec",
  demo: "useCaseDemo",
  explore: "personaExplore",
  import: "requirementImport",
  draft: "useCaseDraft",
} as const;

/**
 * Verify (#E153): Lore runs no agent. The dialog builds the prompt to paste
 * into one, and the command line that prints the same prompt, from the
 * mission, the app copy and the persona played.
 *
 * ⚠️ The preview is fetched when the dialog opens or an option changes
 * (`useQuery`), and Copy writes the text ALREADY loaded, inside the click,
 * with nothing awaited before it: Safari drops the clipboard permission
 * across an `await`.
 *
 * Shown whenever Plan's `requirements` option is on (decision 29).
 */
const VerifyDialog = (props: VerifyDialogProps) => {
  const { tr } = useI18n<I18n, "en">();
  const toaster = useToast();
  const [project] = useStore(currentProjectAtom);
  const promptApi = useClient<RequirementsPromptController>();
  const personaApi = useClient<PersonaController>();
  const projectId = project?.id ?? 0;
  const missions = MISSIONS[props.subject.kind];

  const options = useForm({
    id: "verify-options",
    schema: z.object({
      mission: z
        .enum(["test", "spec", "demo", "explore", "import", "draft"])
        .optional(),
      app: z.text().optional(),
      env: z.text().optional(),
      as: z.text().optional(),
      stale: z.boolean().optional(),
      folio: z.text().optional(),
    }),
    initialValues: {
      mission: props.mission ?? missions[0],
      app: "",
      env: "",
      stale: false,
      folio:
        props.subject.kind === "import" && props.subject.folioShortId
          ? String(props.subject.folioShortId)
          : "",
    },
    handler: async () => {},
  });
  const values = useFormValues(options);

  const personas = useQuery<PersonaResource[]>(
    {
      key: ["personas", projectId],
      enabled: props.open && projectId > 0,
      handler: async () =>
        await personaApi.getPersonas({ params: { projectId }, query: {} }),
    },
    [personaApi, projectId, props.open],
  );

  const mission = (values.mission ?? missions[0]) as VerifyMission;
  const folio = Number(values.folio);
  const ready = props.subject.kind !== "import" || folio > 0;
  const preview = useQuery<{ prompt: string; command: string }>(
    {
      key: [
        "requirements-prompt",
        projectId,
        JSON.stringify(props.subject),
        mission,
        values.app,
        values.env,
        values.as,
        values.stale,
        values.folio,
      ],
      enabled: props.open && projectId > 0 && ready,
      handler: async () =>
        await promptApi.renderRequirementsPrompt({
          params: { projectId },
          query: {
            kind: KIND_OF[mission],
            ...(props.subject.kind === "usecase"
              ? { useCaseNumber: props.subject.number }
              : {}),
            ...(props.subject.kind === "persona"
              ? { personaNumber: props.subject.number }
              : {}),
            ...(props.subject.kind === "import" ? { folioShortId: folio } : {}),
            ...(props.subject.kind === "draft" && props.subject.requirement
              ? { requirementNumber: props.subject.requirement }
              : {}),
            ...(props.subject.kind === "draft" && props.subject.epic
              ? { epicNumber: props.subject.epic }
              : {}),
            ...(props.subject.kind === "persona" && values.stale
              ? { staleOnly: true }
              : {}),
            ...(values.app ? { app: values.app } : {}),
            ...(values.env ? { env: values.env } : {}),
            ...(values.as ? { asPersona: Number(values.as) } : {}),
          },
        }),
    },
    [
      promptApi,
      projectId,
      props.open,
      props.subject,
      mission,
      values.app,
      values.env,
      values.as,
      values.stale,
      values.folio,
      ready,
    ],
  );

  // Synchronous inside the click: the text is the one already loaded.
  const copy = (
    text: string | undefined,
    labelKey:
      | "requirements.verify.copied.prompt"
      | "requirements.verify.copied.command",
  ) => {
    if (!text) return;
    navigator.clipboard.writeText(text).then(
      () => toaster.success(tr(labelKey)),
      () => toaster.error(tr("agentPrompts.copyError")),
    );
  };

  const title =
    props.subject.kind === "usecase"
      ? tr("requirements.verify.title.usecase", {
          args: [formatReference("usecase", props.subject.number)],
        })
      : props.subject.kind === "persona"
        ? tr("requirements.verify.title.persona", {
            args: [formatReference("persona", props.subject.number)],
          })
        : props.subject.kind === "allStale"
          ? tr("requirements.verify.title.allStale")
          : props.subject.kind === "draft"
            ? tr("requirements.verify.title.draft", {
                args: [
                  props.subject.epic
                    ? formatReference("epic", props.subject.epic)
                    : formatReference(
                        "requirement",
                        props.subject.requirement ?? 0,
                      ),
                ],
              })
            : tr("requirements.verify.title.import");

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {tr("requirements.verify.description")}
          </DialogDescription>
        </DialogHeader>
        <form {...options.props} className="flex flex-col gap-3">
          {missions.length > 1 ? (
            <Control
              label={tr("requirements.verify.mission")}
              input={options.input.mission}
              segmented
              items={missions.map((it) => ({
                value: it,
                label: tr(MISSION_LABEL_KEYS[it]),
              }))}
            />
          ) : null}
          {props.subject.kind === "import" ? (
            <Control
              label={tr("requirements.verify.folio")}
              input={options.input.folio}
            />
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <Control
                label={tr("requirements.verify.app")}
                input={options.input.app}
              />
              <Control
                label={tr("requirements.verify.env")}
                input={options.input.env}
              />
              <Control
                label={tr("requirements.verify.as")}
                input={options.input.as}
                select
                clearable
                icon={UserRound}
                // Empty means the primary actor: the placeholder says so,
                // and so does the row that clears a choice.
                placeholder={tr("requirements.verify.as.default")}
                clearLabel={tr("requirements.verify.as.default")}
                items={(personas.data ?? []).map((p) => ({
                  value: String(p.number),
                  label: `${formatReference("persona", p.number)} ${p.name}`,
                }))}
              />
            </div>
          )}
          {props.subject.kind === "persona" ? (
            <Control
              label={tr("requirements.verify.staleOnly")}
              input={options.input.stale}
            />
          ) : null}
        </form>
        <pre
          className="bg-muted max-h-72 overflow-auto rounded-md p-3 text-xs whitespace-pre-wrap"
          data-testid="verify-preview"
        >
          {preview.data?.prompt ??
            (ready ? "…" : tr("requirements.verify.folio.needed"))}
        </pre>
        {preview.data ? (
          <code
            className="bg-muted rounded px-2 py-1 text-xs"
            data-testid="verify-command"
          >
            {preview.data.command}
          </code>
        ) : null}
        <DialogFooter>
          <Button
            variant="outlined"
            disabled={!preview.data}
            onClick={() =>
              copy(preview.data?.command, "requirements.verify.copied.command")
            }
          >
            <Terminal className="size-4" />
            {tr("requirements.verify.copyCommand")}
          </Button>
          <Button
            disabled={!preview.data}
            onClick={() =>
              copy(preview.data?.prompt, "requirements.verify.copied.prompt")
            }
          >
            <Copy className="size-4" />
            {tr("requirements.verify.copyPrompt")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default VerifyDialog;
