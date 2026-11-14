import { useI18n } from "alepha/react/i18n";

import type { ProjectActivityRow } from "../../../../../api/schemas/projectActivityRowSchema.ts";
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
  //
  // A row may also name an `option`: the Support capability's rows were
  // rewritten to `plan` with `option: "feedback"` when #E143 folded it into
  // Plan, so an old event still reads as Feedback being turned on or off.
  const capability = props.metadata?.capability;
  if (typeof capability === "string") {
    const descriptor = capabilityRegistry.find(capability);
    const optionKey = props.metadata?.option;
    const option =
      typeof optionKey === "string"
        ? descriptor?.options.find((it) => it.key === optionKey)
        : undefined;
    const label = option
      ? tr(option.labelKey)
      : descriptor
        ? tr(descriptor.labelKey)
        : capability;
    return (
      <span className="text-muted-foreground text-xs">
        {tr(
          props.metadata?.enabled
            ? "activity.capability.enabled"
            : "activity.capability.disabled",
          { args: [label] },
        )}
      </span>
    );
  }

  // An epic review filed (#E121): how many of each kind it held.
  const questions = props.metadata?.questions;
  if (typeof questions === "number") {
    return (
      <span className="text-muted-foreground text-xs">
        {tr("activity.review.filed", {
          args: [
            String(questions),
            String(props.metadata?.decisions ?? 0),
            String(props.metadata?.changes ?? 0),
          ],
        })}
      </span>
    );
  }

  // An answer to one review item: which, and what became of it.
  const outcome = props.metadata?.outcome;
  const item = props.metadata?.item;
  if (typeof outcome === "string" && typeof item === "number") {
    return (
      <span className="text-muted-foreground text-xs">
        {outcome === "overturned"
          ? tr("activity.review.overturned", {
              args: [String(item), String(props.metadata?.replacement ?? "")],
            })
          : outcome === "waived"
            ? tr("activity.review.waived", { args: [String(item)] })
            : tr("activity.review.answered", { args: [String(item)] })}
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
