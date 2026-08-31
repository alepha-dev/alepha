import { Control } from "@alepha/ui/components/control/control";
import { Button } from "@alepha/ui/components/ui/button";
import { useToast } from "@alepha/ui/components/use-toast/use-toast";
import { z } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { useClient, useInject } from "alepha/react";
import { useForm, useFormState } from "alepha/react/form";
import { useI18n } from "alepha/react/i18n";
import { useRouter } from "alepha/react/router";
import {
  AlertTriangle,
  CalendarClock,
  FileText,
  Save,
  Tag,
  Type,
} from "lucide-react";

import type { ReleaseController } from "@/api/controllers/ReleaseController.ts";
import type { Release } from "@/api/entities/releases.ts";
import type { ReleaseResource } from "@/api/schemas/releaseResourceSchema.ts";
import { RELEASE_TAG_MAX_LENGTH } from "@/api/schemas/releaseTagSchema.ts";
import type { AppRouter } from "@/web/app/AppRouter.ts";
import type { I18n } from "@/web/app/services/I18n.ts";

import ReleaseDescriptionEditor from "./ReleaseDescriptionEditor.tsx";

export interface ReleaseEditFormProps {
  release: ReleaseResource;
  /**
   * How many artifacts this page is currently showing for the saved tag.
   * Named in the warning band, because "this may break things" is not a
   * warning - a number is.
   */
  artifactCount: number;
  onSubmit: (release: Release) => void;
  onCancel: () => void;
}

/**
 * Editing a release, on `useForm` + `Control` like every other Lore form.
 *
 * It was a hand-rolled stack of `<Input>` and `<label>` pairs inside a
 * dialog, which is why its date field rendered the browser's raw
 * `dd/mm/yyyy` and its description was a bare textarea. Both are what the
 * shared controls exist to stop: `Control` picks `ControlDate` from the
 * schema, and the description goes through the same View/Edit markdown
 * surface a quest's does.
 *
 * ## Draft semantics
 *
 * `useForm` anchors its schema AND its initial values at mount, so the
 * snapshot is the mount. `ReleaseEditSheet` keys this component on the
 * release, which is what makes reopening the drawer re-read the release
 * rather than reopening on an abandoned draft.
 */
const ReleaseEditForm = (props: ReleaseEditFormProps) => {
  const { tr } = useI18n<I18n, "en">();
  const toaster = useToast();
  const api = useClient<ReleaseController>();
  const router = useRouter<AppRouter>();
  const dt = useInject(DateTimeProvider);

  const savedTag = props.release.tag ?? "";

  const form = useForm({
    id: "release-edit",
    schema: z.object({
      tag: z.string().min(1).max(RELEASE_TAG_MAX_LENGTH),
      title: z.string().min(1).max(100),
      // ⚠️ `YYYY-MM-DD` in the FORM, an instant on the WIRE, the same split
      // the quest's `dueAt` documents. Declared as a date rather than a
      // datetime so `ControlDate` parses and formats it locally; the handler
      // below widens it back to an instant.
      targetDate: z.date().nullable().optional(),
      description: z.string().optional(),
    }),
    initialValues: {
      tag: savedTag,
      title: props.release.title,
      // The stored instant as the day it falls on in the reader's own
      // timezone. Never `toISOString().slice(0, 10)`, which shifts the day
      // backwards west of UTC.
      targetDate: props.release.targetDate
        ? dt.of(props.release.targetDate).format("YYYY-MM-DD")
        : undefined,
      description: props.release.description,
    },
    handler: async (input) => {
      const nextTag = input.tag.trim();
      try {
        const updated = await api.updateRelease({
          params: { id: props.release.id },
          body: {
            // An empty tag falls back to the saved one rather than clearing
            // the release's identity: the field is required on the way in,
            // and a blank save would be a way around that.
            ...(nextTag ? { tag: nextTag } : {}),
            title: input.title,
            description: input.description ?? "",
            // Midnight rather than the quest's end-of-day: a target is an
            // estimate nothing enforces, so there is no deadline to be late
            // against and no hour to get right.
            targetDate: input.targetDate
              ? dt.of(input.targetDate).startOf("day").toDate().toISOString()
              : null,
          },
        });
        props.onSubmit(updated);
        toaster.success(tr("release.detail.saved"));

        // The URL this page is sitting on went stale the moment that
        // resolved.
        if (updated.tag && updated.tag !== savedTag) {
          await router.push("projectRelease", {
            params: { releaseTag: updated.tag },
          });
        }
      } catch {
        // The drawer stays open holding what was typed: the save failed, so
        // the form is still the unsaved truth.
        toaster.error(tr("release.detail.error"));
      }
    },
  });

  const { loading: submitting, values } = useFormState(form, [
    "loading",
    "values",
  ]);

  const draftTag = String(values?.tag ?? savedTag).trim();
  const draftTitle = String(values?.title ?? props.release.title).trim();
  const retagging = draftTag !== "" && draftTag !== savedTag;

  return (
    <form {...form.props} className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-4">
        {/* Tag and Title share a row, the 50/50 the Create Quest form gives
            Name and Area. They are the two halves of what a release is
            called: the one thing joins on, the one thing does not. */}
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <Control
            label={tr("release.detail.editTag")}
            description={
              retagging ? undefined : String(tr("release.edit.tagHint"))
            }
            input={form.input.tag}
            icon={Tag}
            inputProps={{ className: "font-mono" }}
            bottom={
              retagging ? (
                // ⚠️ The band replaces a confirmation dialog this form used
                // to pop on Save. That asked the question after the decision
                // was made; the band asks it while the tag is being typed,
                // and names both consequences with the numbers it has.
                <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/15 px-3 py-2 text-xs leading-[1.55]">
                  <AlertTriangle
                    className="mt-px size-3.5 shrink-0"
                    aria-hidden
                  />
                  <span>
                    {props.artifactCount > 0 && (
                      <>
                        {props.artifactCount === 1
                          ? tr("release.edit.tagWarning.artifacts.one", {
                              args: [savedTag],
                            })
                          : tr("release.edit.tagWarning.artifacts.many", {
                              args: [String(props.artifactCount), savedTag],
                            })}{" "}
                      </>
                    )}
                    {tr("release.edit.tagWarning.url", { args: [savedTag] })}
                  </span>
                </div>
              ) : undefined
            }
          />
          {/* The hint switches on the value, because "empty" and "set" are
              two different behaviours and only one of them is true at a
              time. Read from the DRAFT tag, not the saved one: it describes
              what saving this form will produce. */}
          <Control
            label={tr("release.detail.editTitle")}
            description={String(
              !draftTitle || draftTitle === draftTag
                ? tr("release.edit.titleHint.empty")
                : tr("release.edit.titleHint.set"),
            )}
            input={form.input.title}
            icon={Type}
            placeholder={draftTag || savedTag}
          />
        </div>

        <Control
          label={tr("release.detail.editTargetDate")}
          description={tr("release.edit.targetHint")}
          input={form.input.targetDate}
          icon={CalendarClock}
          clearable
        />

        <Control
          label={tr("release.edit.description")}
          description={tr("release.edit.descriptionHint")}
          input={form.input.description}
          icon={FileText}
          custom={ReleaseDescriptionEditor as never}
        />
      </div>

      <div className="bg-background flex shrink-0 justify-end gap-2 border-t p-4">
        <Button
          type="button"
          variant="outline"
          disabled={submitting}
          onClick={props.onCancel}
        >
          {tr("common.cancel")}
        </Button>
        <Button type="submit" disabled={submitting}>
          <Save className="size-4" />
          {tr("release.detail.save")}
        </Button>
      </div>
    </form>
  );
};

export default ReleaseEditForm;
