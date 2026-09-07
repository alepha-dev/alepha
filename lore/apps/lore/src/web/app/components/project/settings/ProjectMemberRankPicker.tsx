import { Control } from "@alepha/ui/components/control/control";
import { Badge } from "@alepha/ui/components/ui/badge";
import { useToast } from "@alepha/ui/components/use-toast/use-toast";
import { z } from "alepha";
import type { RankController, RankResource } from "alepha/api/ranks";
import { useClient } from "alepha/react";
import { useForm } from "alepha/react/form";
import { useI18n } from "alepha/react/i18n";
import { useState } from "react";

import type { I18n } from "@/web/app/services/I18n.ts";

/**
 * The one field this picker is.
 *
 * ⚠️ **Required, not optional**, and that is load-bearing rather than
 * tidy: `Control` derives `deselectable` from `clearable || !required`, so
 * an optional field would clear itself when the reader re-presses the rank
 * they already hold - and this control saves on change, so that would post
 * `undefined` as a rank.
 */
const rankFieldSchema = z.object({ rank: z.text() });

export interface ProjectMemberRankPickerProps {
  projectId: number;

  userId: string;

  /**
   * The rank stored on the membership row. `undefined` is a row written
   * before epic #E39's backfill, and reads as `member` - the same fallback
   * the server applies.
   */
  rank?: string;

  ranks: RankResource[];

  /**
   * True for the caller's own row. Rendered as a badge rather than a picker:
   * the module refuses a self-assignment (no self-lockout, no
   * self-escalation), so a select here could only ever answer 400.
   */
  self: boolean;

  /**
   * Whether this reader may assign at all. False renders the badge.
   */
  canAssign: boolean;

  onAssigned: () => void | Promise<void>;
}

/**
 * One member's rank, as a select on their row.
 *
 * A select rather than a set of checkboxes because a person holds exactly one
 * rank; what that rank GRANTS is the matrix, one page over.
 *
 * ⚠️ **Not optimistic.** The value follows the server's answer, and the
 * control is disabled until it lands. An optimistic rank picker is the exact
 * shape of the e2e trap in Lore's own notes: the assertion passes before the
 * save is sent, so a refusal - and the module has five of them - would leave
 * the row showing a rank nobody holds.
 *
 * A `Control` bound to a one-field form rather than a raw `Select` (feedback
 * #P2121). ⚠️ The binding is what makes the paragraph above take work: a form
 * field holds the value the reader picked, where the raw select was told what
 * to show by a prop. `initialValues` re-seeds from `props.rank` when the
 * refetch lands, which covers the success path; the failure path has to put
 * the field back by hand, and {@link assign}'s own no-op guard is what stops
 * that write re-entering as a second save.
 */
const ProjectMemberRankPicker = (props: ProjectMemberRankPickerProps) => {
  const { tr } = useI18n<I18n, "en">();
  const toaster = useToast();
  const api = useClient<RankController>();
  const [saving, setSaving] = useState(false);

  const current = props.rank ?? "member";
  const named = props.ranks.find((it) => it.key === current);
  const label = named?.name ?? current;

  const form = useForm({
    schema: rankFieldSchema,
    // Re-seeded when the parent refetches, which is the whole success path:
    // the field follows the server rather than the click.
    initialValues: { rank: current },
    // Saving on change is what this control is - there is nothing else on the
    // row to submit beside it - so the form's own submit is never reached.
    handler: () => {},
    onChange: (_key, value) => void assign(String(value ?? current)),
  });

  // ⚠️ Nothing at all for a reader who cannot assign. `MemberIdentity` beside
  // the name already carries the rank, and this one would be a second badge
  // saying the same thing - showing the raw KEY, because the rank list is
  // `assertCanManage`-gated and comes back empty for exactly this reader.
  if (!props.canAssign) {
    return null;
  }

  // The owner's row is never a picker: ownership is transferred, which is a
  // different act with a different confirmation and a different consequence
  // for the person doing it. It lives in the row's menu. Neither is the
  // caller's own row: the module refuses a self-assignment, so a select there
  // could only ever answer 400.
  if (props.self || current === "owner") {
    return (
      <Badge variant={current === "owner" ? "default" : "secondary"}>
        {label}
      </Badge>
    );
  }

  const assign = async (key: string) => {
    // ⚠️ Also the re-entrancy guard for the restore below: putting the field
    // back to `current` calls this again, and this line ends it.
    if (key === current) return;
    setSaving(true);
    try {
      await api.assignRank({
        params: {
          type: "project",
          scopeId: String(props.projectId),
          userId: props.userId,
        },
        body: { key },
      });
      await props.onAssigned();
      toaster.success(tr("project.settings.members.rank.assigned"));
    } catch (error) {
      // ⚠️ Back to what the server still says. Nothing refetches on a
      // refusal, so `initialValues` does not change and the field would keep
      // showing a rank nobody holds - which is the whole reason this control
      // is documented as not optimistic.
      form.input.rank.set(current);
      // The module's own refusal wins: "You cannot change your own rank",
      // "cannot grant a permission you do not hold" and the owner-target
      // refusal each name the rule, and a catalogue string would replace an
      // answer with a shrug.
      toaster.error(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Control
      select
      input={form.input.rank}
      label=""
      disabled={saving}
      triggerClassName="w-40"
      // The trigger reads the resolved NAME rather than the value, because
      // `Control` looks the label up in `items` - which is what the raw
      // select needed `<SelectValue>{label}</SelectValue>` for: Base UI
      // rendered the value there, and a rank's value is its opaque key, so
      // the trigger read `r1x9k2` for every rank somebody created.
      items={props.ranks
        // `owner` is not an assignment target, and the module refuses it.
        // Offering it and then explaining the refusal is worse than not
        // offering it.
        .filter((it) => it.key !== "owner")
        .map((rank) => ({ value: rank.key, label: rank.name }))}
      // ⚠️ `data-testid` and the accessible name both ride here: `Control`
      // forwards `inputProps` to whichever trigger the field renders, and
      // `e2e/ranks.spec.ts` counts `member-rank` to prove a Viewer sees no
      // picker at all.
      inputProps={{
        "data-testid": "member-rank",
        "aria-label": String(tr("project.settings.members.rank.label")),
      }}
      // The rank the row currently holds, for a list that has not loaded yet:
      // with no matching item the trigger would otherwise be blank.
      placeholder={label}
    />
  );
};

export default ProjectMemberRankPicker;
