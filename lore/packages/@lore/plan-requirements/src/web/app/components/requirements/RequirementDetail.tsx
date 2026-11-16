import { Button, Card, CardContent, useDialog } from "@alepha/ui";
import { Control } from "@alepha/ui/form";
import { MarkdownView } from "@alepha/ui/markdown";
import {
  canInProject,
  currentProjectAtom,
  formatReference,
  type I18n,
} from "@lore/core/web";
import { z } from "alepha";
import { useAction, useClient, useStore } from "alepha/react";
import { useForm } from "alepha/react/form";
import { useI18n } from "alepha/react/i18n";
import { Pencil, Trash2 } from "lucide-react";

import type { RequirementController } from "../../../../api/controllers/RequirementController.ts";
import type { RequirementResource } from "../../../../api/schemas/requirementResourceSchema.ts";
import {
  REQUIREMENT_PRIORITY_LABEL_KEYS,
  REQUIREMENT_TYPE_LABEL_KEYS,
} from "./requirementLabels.ts";
import RequirementStatusChips from "./RequirementStatusChips.tsx";

export interface RequirementDetailProps {
  requirement: RequirementResource;
  releases: Array<{ id: number; tag?: string; title?: string }>;
  onChange: (requirement: RequirementResource) => void;
  onEdit: () => void;
  onDeleted: () => void;
}

/**
 * The detail pane beside the Requirements list (#E153): statement, type and
 * priority, source, the personas concerned (through the use cases), the
 * Target release selector with its auto / by hand note and the confirm
 * listing every epic it would move, the criteria verifying it, and Source
 * changed's Update / Keep.
 */
const RequirementDetail = (props: RequirementDetailProps) => {
  const { tr } = useI18n<I18n, "en">();
  const dialog = useDialog();
  const [project] = useStore(currentProjectAtom);
  const api = useClient<RequirementController>();
  const it = props.requirement;
  const canWrite = !!project && canInProject(project, "requirement:write");

  const setRelease = useAction<[releaseId: number | null], void>(
    {
      handler: async (_ctx, releaseId) => {
        const first = await api.setRequirementRelease({
          params: { id: it.id },
          body: { releaseId },
        });
        if (first.applied) {
          props.onChange(first.requirement);
          return;
        }
        const ok = await dialog.confirm({
          title: tr("requirements.requirement.release.confirm.title"),
          description: first.moves
            .map(
              (move) =>
                `${formatReference("epic", move.epicNumber)} ${move.epicTitle}${
                  move.alsoCovers.length
                    ? ` (${tr("requirements.requirement.release.alsoCovers", {
                        args: [
                          move.alsoCovers
                            .map((n) => formatReference("requirement", n))
                            .join(", "),
                        ],
                      })})`
                    : ""
                }`,
            )
            .join("\n"),
          confirmLabel: tr("requirements.requirement.release.confirm.action"),
        });
        if (!ok) return;
        const done = await api.setRequirementRelease({
          params: { id: it.id },
          body: { releaseId, confirm: true },
        });
        props.onChange(done.requirement);
      },
    },
    [api, it.id, dialog, tr, props.onChange],
  );

  const resync = useAction<[], void>(
    {
      handler: async () => {
        props.onChange(
          await api.resyncRequirementSource({ params: { id: it.id } }),
        );
      },
    },
    [api, it.id, props.onChange],
  );

  const remove = useAction<[], void>(
    {
      handler: async () => {
        const ok = await dialog.confirm({
          title: tr("requirements.requirement.delete.title"),
          description: tr("requirements.requirement.delete.description", {
            args: [it.statement],
          }),
          confirmLabel: tr("requirements.requirement.delete.confirm"),
          destructive: true,
        });
        if (!ok) return;
        await api.deleteRequirement({ params: { id: it.id } });
        props.onDeleted();
      },
    },
    [api, it.id, it.statement, dialog, tr, props.onDeleted],
  );

  const release = useForm(
    {
      id: `requirement-release-${it.id}`,
      schema: z.object({ releaseId: z.text() }),
      initialValues: {
        releaseId: it.targetRelease ? String(it.targetRelease.id) : "",
      },
      onChange: (_name, value) => {
        void setRelease.run(value ? Number(value) : null);
      },
      handler: async () => {},
    },
    [it.id, it.targetRelease?.id],
  );
  const busy = setRelease.loading || remove.loading || resync.loading;

  return (
    <div className="flex flex-col gap-4 p-4" data-testid="requirement-detail">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-mono">
          {formatReference("requirement", it.number)}
        </span>
        {it.paragraph ? (
          <span className="text-muted-foreground">§{it.paragraph}</span>
        ) : null}
        <RequirementStatusChips requirement={it} />
      </div>
      <h2 className="text-lg font-semibold">{it.statement}</h2>
      {it.description ? <MarkdownView content={it.description} /> : null}
      <dl className="grid grid-cols-[7rem_1fr] gap-x-3 gap-y-1 text-sm">
        <dt className="text-muted-foreground">
          {tr("requirements.requirement.field.type")}
        </dt>
        <dd>
          {tr(REQUIREMENT_TYPE_LABEL_KEYS[it.type])} ·{" "}
          {tr(REQUIREMENT_PRIORITY_LABEL_KEYS[it.priority])}
        </dd>
        {it.chapter ? (
          <>
            <dt className="text-muted-foreground">
              {tr("requirements.requirement.field.chapter")}
            </dt>
            <dd>{it.chapter}</dd>
          </>
        ) : null}
        {it.sourceFolioId ? (
          <>
            <dt className="text-muted-foreground">
              {tr("requirements.requirement.field.source")}
            </dt>
            <dd>
              {it.sourceAnchor
                ? `#${it.sourceAnchor}`
                : tr("requirements.requirement.source.whole")}
            </dd>
          </>
        ) : null}
        {it.personas.length ? (
          <>
            <dt className="text-muted-foreground">
              {tr("requirements.requirement.field.personas")}
            </dt>
            <dd>
              {it.personas.map((p) => p.name).join(", ")}{" "}
              <span className="text-muted-foreground text-xs">
                {tr("requirements.requirement.personas.through")}
              </span>
            </dd>
          </>
        ) : null}
      </dl>

      {it.sourceChanged ? (
        <Card>
          <CardContent
            className="flex flex-col gap-2 text-sm"
            data-testid="source-changed-panel"
          >
            <p className="font-semibold">
              {tr(
                it.sourceChangeKind === "removed"
                  ? "requirements.requirement.source.removed"
                  : "requirements.requirement.source.edited",
              )}
            </p>
            {it.sourceSectionText ? (
              <blockquote className="text-muted-foreground border-l-2 pl-3 text-xs whitespace-pre-wrap">
                {it.sourceSectionText}
              </blockquote>
            ) : null}
            {canWrite ? (
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outlined"
                  disabled={busy}
                  onClick={props.onEdit}
                >
                  {tr("requirements.requirement.source.update")}
                </Button>
                <Button
                  size="sm"
                  variant="outlined"
                  disabled={busy}
                  onClick={() => void resync.run()}
                >
                  {tr("requirements.requirement.source.keep")}
                </Button>
              </div>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardContent className="flex flex-col gap-2 text-sm">
          <form {...release.props}>
            <Control
              label={tr("requirements.requirement.release")}
              input={release.input.releaseId}
              select
              disabled={!canWrite || busy}
              items={[
                {
                  value: "",
                  label: tr("requirements.requirement.release.none"),
                },
                ...props.releases.map((r) => ({
                  value: String(r.id),
                  label: r.tag ?? r.title ?? String(r.id),
                })),
              ]}
            />
          </form>
          {it.targetRelease ? (
            <p
              className="text-muted-foreground text-xs"
              data-testid="release-note"
            >
              {it.targetRelease.mode === "auto"
                ? tr("requirements.requirement.release.auto", {
                    args: [
                      it.coveringEpics
                        .map((e) => formatReference("epic", e.number))
                        .join(", "),
                    ],
                  })
                : tr("requirements.requirement.release.byHand")}
            </p>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="flex flex-col gap-2 text-sm">
          <h3 className="font-semibold">
            {tr("requirements.requirement.verifiedBy", {
              args: [String(it.criteria.length)],
            })}
          </h3>
          {it.criteria.length === 0 ? (
            <p className="text-muted-foreground text-xs">
              {tr("requirements.requirement.verifiedBy.none")}
            </p>
          ) : (
            <ul className="flex flex-col gap-1">
              {it.criteria.map((c) => (
                <li key={`${c.useCaseNumber}:${c.key}`}>
                  <span className="font-semibold">
                    {formatReference("usecase", c.useCaseNumber)} {c.key}
                  </span>{" "}
                  <span className="text-muted-foreground">{c.summary}</span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {canWrite ? (
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="outlined"
            disabled={busy}
            onClick={props.onEdit}
          >
            <Pencil className="size-4" />
            {tr("requirements.requirement.edit")}
          </Button>
          <Button
            size="sm"
            variant="outlined"
            disabled={busy}
            onClick={() => void remove.run()}
          >
            <Trash2 className="size-4" />
            {tr("requirements.persona.delete")}
          </Button>
        </div>
      ) : null}
    </div>
  );
};

export default RequirementDetail;
