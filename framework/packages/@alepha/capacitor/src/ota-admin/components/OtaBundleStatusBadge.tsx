import { Badge } from "@alepha/ui";
import { useI18n } from "alepha/react/i18n";

import type { OtaBundleResource } from "../../ota-api/schemas/otaBundleResourceSchema.ts";

export interface OtaBundleStatusBadgeProps {
  bundle: Pick<OtaBundleResource, "status" | "killedAt">;
}

/**
 * Killed first, whatever the status: a killed bundle is never served.
 */
export const OtaBundleStatusBadge = (props: OtaBundleStatusBadgeProps) => {
  const { tr } = useI18n();
  if (props.bundle.killedAt) {
    return (
      <Badge variant="tint" tone="danger">
        {tr("ota.admin.status.killed", { default: "Killed" })}
      </Badge>
    );
  }
  switch (props.bundle.status) {
    case "ready":
      return (
        <Badge variant="tint" tone="success">
          {tr("ota.admin.status.ready", { default: "Ready" })}
        </Badge>
      );
    case "uploading":
      return (
        <Badge variant="tint" tone="info">
          {tr("ota.admin.status.uploading", { default: "Uploading" })}
        </Badge>
      );
    case "failed":
      return (
        <Badge variant="tint" tone="warning">
          {tr("ota.admin.status.failed", { default: "Failed" })}
        </Badge>
      );
    case "deleted":
      return (
        <Badge variant="tint" tone="neutral">
          {tr("ota.admin.status.deleted", { default: "Deleted" })}
        </Badge>
      );
  }
};
