import { Badge } from "@alepha/ui/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@alepha/ui/components/ui/select";
import { useToast } from "@alepha/ui/components/use-toast/use-toast";
import type { RankController, RankResource } from "alepha/api/ranks";
import { useClient } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { useState } from "react";

import type { I18n } from "@/web/app/services/I18n.ts";

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
 */
const ProjectMemberRankPicker = (props: ProjectMemberRankPickerProps) => {
  const { tr } = useI18n<I18n, "en">();
  const toaster = useToast();
  const api = useClient<RankController>();
  const [saving, setSaving] = useState(false);

  const current = props.rank ?? "member";
  const named = props.ranks.find((it) => it.key === current);
  const label = named?.name ?? current;

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
    <Select
      value={current}
      disabled={saving}
      onValueChange={(value) => void assign(String(value))}
    >
      <SelectTrigger
        className="w-40"
        data-testid="member-rank"
        aria-label={String(tr("project.settings.members.rank.label"))}
      >
        {/* The resolved NAME, not `<SelectValue />`. Base UI renders the raw
            value there, and a rank's value is its opaque key - so the trigger
            read `r1x9k2` for every rank somebody created, while the list
            underneath read their names. */}
        <SelectValue>{label}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        {props.ranks
          // `owner` is not an assignment target, and the module refuses it.
          // Offering it and then explaining the refusal is worse than not
          // offering it.
          .filter((it) => it.key !== "owner")
          .map((rank) => (
            <SelectItem key={rank.key} value={rank.key}>
              {rank.name}
            </SelectItem>
          ))}
      </SelectContent>
    </Select>
  );
};

export default ProjectMemberRankPicker;
