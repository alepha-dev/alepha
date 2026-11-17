import { useDialog } from "@alepha/ui";
import { Control } from "@alepha/ui/form";
import { formatReference, type I18n } from "@lore/core/web";
import { z } from "alepha";
import { useAction, useClient } from "alepha/react";
import { useForm } from "alepha/react/form";
import { useI18n } from "alepha/react/i18n";
import { Flag } from "lucide-react";

import type { RequirementController } from "../../../../api/controllers/RequirementController.ts";
import type { RequirementResource } from "../../../../api/schemas/requirementResourceSchema.ts";

export interface RequirementReleaseControlProps {
  requirement: RequirementResource;
  releases: Array<{ id: number; tag?: string; title?: string }>;
  disabled?: boolean;
  onChange: (requirement: RequirementResource) => void;
}

/**
 * A requirement's Target release, in its aside (#E153): the control an
 * epic's release row is, empty by default, cleared by its own "No release"
 * row, under the release glyph. Picking a row IS the write; one that would
 * move epics lists them in a confirm first.
 */
const RequirementReleaseControl = (props: RequirementReleaseControlProps) => {
  const { tr } = useI18n<I18n, "en">();
  const dialog = useDialog();
  const api = useClient<RequirementController>();
  const it = props.requirement;

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
        if (!ok) {
          // The trigger goes back to what the server holds.
          form.setInitialValues(
            {
              releaseId: it.targetRelease
                ? String(it.targetRelease.id)
                : undefined,
            },
            { keepDirty: false },
          );
          return;
        }
        const done = await api.setRequirementRelease({
          params: { id: it.id },
          body: { releaseId, confirm: true },
        });
        props.onChange(done.requirement);
      },
    },
    [api, it.id, it.targetRelease?.id, dialog, tr, props.onChange],
  );

  const form = useForm(
    {
      id: `requirement-release-${it.id}`,
      schema: z.object({ releaseId: z.text().optional() }),
      initialValues: {
        releaseId: it.targetRelease ? String(it.targetRelease.id) : undefined,
      },
      keepDirty: false,
      // Nothing is submitted: picking a row IS the write.
      onChange: (_name, value) => {
        void setRelease.run(value ? Number(value) : null);
      },
      handler: async () => {},
    },
    [it.id, it.targetRelease?.id],
  );

  return (
    <form {...form.props} className="flex flex-col gap-1">
      <Control
        input={form.input.releaseId}
        // The aside row carries the label; the trigger names itself to
        // assistive tech.
        label=""
        inputProps={{
          "aria-label": tr("requirements.requirement.release"),
          "data-testid": "requirement-release",
        }}
        select
        clearable
        icon={Flag}
        placeholder={tr("requirements.requirement.release.none")}
        clearLabel={tr("requirements.requirement.release.none")}
        triggerClassName="w-full"
        disabled={props.disabled || setRelease.loading}
        items={props.releases.map((r) => ({
          value: String(r.id),
          label: r.tag ?? r.title ?? String(r.id),
        }))}
      />
      {it.targetRelease ? (
        <p className="text-muted-foreground text-xs" data-testid="release-note">
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
    </form>
  );
};

export default RequirementReleaseControl;
