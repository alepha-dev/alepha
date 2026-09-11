import { Badge } from "@alepha/ui/components/ui/badge";
import { useI18n } from "alepha/react/i18n";
import { Ban, CircleCheck } from "lucide-react";

export interface AdminUsersStatusBadgeProps {
  enabled: boolean;
}

/**
 * Whether an account may sign in, as a tinted chip with a glyph (feedback
 * #2192, #Q2247).
 *
 * The same design as Lore's epic and quest statuses and as
 * `AdminNotificationsStatusBadge`: a near-transparent `tint` in a semantic
 * tone, plus a glyph so the chip still reads in monochrome and for a reader
 * who cannot separate the hues. It replaced a solid `default` badge that was
 * the loudest thing in every row for the most ordinary fact in it.
 *
 * Active is `success` with a check, because it is the healthy state and the
 * one nearly every row is in; the tint keeps a whole column of them quiet.
 * Disabled is `danger` with a ban, because it is the one an operator acts
 * on: the account is refused at sign-in.
 *
 * Shared by the users list and the user detail page, so the two cannot show
 * the same status two ways.
 */
export const AdminUsersStatusBadge = (props: AdminUsersStatusBadgeProps) => {
  const { tr } = useI18n();

  return props.enabled ? (
    <Badge variant="tint" tone="success">
      <CircleCheck className="size-3" />
      {tr("admin.users.active", { default: "Active" })}
    </Badge>
  ) : (
    <Badge variant="tint" tone="danger">
      <Ban className="size-3" />
      {tr("admin.users.statusDisabled", { default: "Disabled" })}
    </Badge>
  );
};
