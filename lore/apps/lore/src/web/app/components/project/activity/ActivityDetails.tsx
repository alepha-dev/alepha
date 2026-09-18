import { useI18n } from "alepha/react/i18n";

import type { ProjectActivityRow } from "@/api/schemas/projectActivityRowSchema.ts";

import { capabilityRegistry } from "../../../services/capabilityRegistry.ts";
import type { I18n } from "../../../services/I18n.ts";

export interface ActivityDetailsProps {
  /**
   * The audit row's `metadata`, as written by its `$audit` call site.
   */
  metadata: ProjectActivityRow["metadata"];
}

/**
 * What an activity row changed, in one line, or nothing when the row does not
 * say.
 *
 * Shared by the project's Activity table (its Details column) and Home's
 * expanded activity line, so the two read an event the same way.
 */
export const ActivityDetails = (props: ActivityDetailsProps) => {
  const { tr } = useI18n<I18n, "en">();

  // A capability row names the switch and its new state. It has no `fields`,
  // because nothing on the project row changed - the event is a
  // `project_capabilities` row appearing or going.
  const capability = props.metadata?.capability;
  if (typeof capability === "string") {
    const descriptor = capabilityRegistry.find(capability);
    return (
      <span className="text-muted-foreground text-xs">
        {tr(
          props.metadata?.enabled
            ? "activity.capability.enabled"
            : "activity.capability.disabled",
          {
            args: [descriptor ? tr(descriptor.labelKey as never) : capability],
          },
        )}
      </span>
    );
  }

  const fields = props.metadata?.fields;
  if (!Array.isArray(fields) || fields.length === 0) {
    return null;
  }
  return (
    <span className="text-muted-foreground text-xs">
      {tr("activity.fields", { args: [fields.join(", ")] })}
    </span>
  );
};
