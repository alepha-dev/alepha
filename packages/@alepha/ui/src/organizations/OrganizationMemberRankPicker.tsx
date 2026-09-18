import { z } from "alepha";
import type {
  OrganizationRankController,
  OrganizationRankResource,
} from "alepha/api/organizations";
import { useClient } from "alepha/react";
import { useForm } from "alepha/react/form";
import { useI18n } from "alepha/react/i18n";
import { useState } from "react";

import { Badge } from "../core/Badge.tsx";
import { useToast } from "../core/useToast.tsx";
import { Control } from "../form/Control.tsx";

const rankFieldSchema = z.object({ rank: z.text() });

export interface OrganizationMemberRankPickerProps {
  organizationId: string;
  userId: string;
  rank?: string;
  ranks: OrganizationRankResource[];
  self: boolean;
  canAssign: boolean;
  onAssigned: () => void | Promise<void>;
  onBusyChange?: (busy: boolean) => void;
}

export const OrganizationMemberRankPicker = (
  props: OrganizationMemberRankPickerProps,
) => {
  const api = useClient<OrganizationRankController>();
  const toaster = useToast();
  const { tr } = useI18n();
  const [saving, setSaving] = useState(false);
  const current = props.rank ?? "member";
  const label =
    props.ranks.find((rank) => rank.key === current)?.name ?? current;

  const form = useForm({
    schema: rankFieldSchema,
    initialValues: { rank: current },
    handler: () => {},
    onChange: (_key, value) => void assign(String(value ?? current)),
  });

  const assign = async (key: string) => {
    if (key === current) return;
    setSaving(true);
    props.onBusyChange?.(true);
    try {
      await api.assignOrganizationRank({
        params: { organizationId: props.organizationId, userId: props.userId },
        body: { key },
      });
      await props.onAssigned();
      toaster.success(
        tr("organizations.members.rankAssigned", {
          default: "Rank updated",
        }),
      );
    } catch (error) {
      form.input.rank.set(current);
      toaster.error(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
      props.onBusyChange?.(false);
    }
  };

  if (!props.canAssign) return null;

  if (props.self || current === "owner") {
    return (
      <Badge variant={current === "owner" ? "default" : "secondary"}>
        {label}
      </Badge>
    );
  }

  return (
    <Control
      select
      input={form.input.rank}
      label=""
      disabled={saving}
      triggerClassName="w-40"
      items={props.ranks
        .filter((rank) => rank.key !== "owner")
        .map((rank) => ({ value: rank.key, label: rank.name }))}
      inputProps={{
        "data-testid": "member-rank",
        "aria-label": tr("organizations.members.rank", { default: "Rank" }),
      }}
      placeholder={label}
    />
  );
};
