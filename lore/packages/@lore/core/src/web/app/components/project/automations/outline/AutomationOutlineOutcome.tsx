import { Badge } from "@alepha/ui";
import { useI18n } from "alepha/react/i18n";
import {
  Check,
  CircleAlert,
  Clock,
  type LucideIcon,
  Minus,
  Play,
  X,
} from "lucide-react";

import type { AutomationNodeOutcome } from "../../../../../../api/schemas/automationNodeOutcomeSchema.ts";
import type { I18n } from "../../../../services/I18n.ts";

export interface AutomationOutlineOutcomeProps {
  outcome: AutomationNodeOutcome["outcome"];
  /**
   * The ports a condition took; on an event, that it started the run.
   */
  ports?: NonNullable<AutomationNodeOutcome["port"]>[];
  kind: "source" | "read" | "condition" | "action" | "transform";
  testId?: string;
}

/**
 * What a row did in a run (#Q3847): one badge, the worst of its rows; a
 * condition says which way it went, an event that it started the run.
 */
const AutomationOutlineOutcome = (props: AutomationOutlineOutcomeProps) => {
  const { tr } = useI18n<I18n, "en">();
  const looks: Record<
    AutomationNodeOutcome["outcome"],
    {
      tone: "success" | "danger" | "warning" | "neutral";
      icon: LucideIcon;
      text: string;
    }
  > = {
    ran: { tone: "success", icon: Check, text: tr("automation.outline.ran") },
    skipped: {
      tone: "neutral",
      icon: Minus,
      text: tr("automation.effect.skipped"),
    },
    refused: { tone: "danger", icon: X, text: tr("automation.effect.refused") },
    failed: { tone: "danger", icon: X, text: tr("automation.effect.failed") },
    unknown: {
      tone: "warning",
      icon: CircleAlert,
      text: tr("automation.effect.unknown"),
    },
    not_reached: {
      tone: "neutral",
      icon: Minus,
      text: tr("automation.outline.notReached"),
    },
    pending: {
      tone: "warning",
      icon: Clock,
      text: tr("automation.effect.pending"),
    },
  };
  if (props.kind === "source" && props.outcome === "ran")
    return (
      <Badge
        variant="tint"
        tone="info"
        data-testid={props.testId}
        data-outcome="ran"
      >
        <Play />
        {tr("automation.outline.started")}
      </Badge>
    );
  if (props.kind === "condition" && props.outcome === "ran") {
    const ports = props.ports ?? [];
    return (
      <Badge
        variant="tint"
        tone={ports.includes("true") ? "success" : "neutral"}
        data-testid={props.testId}
        data-outcome="ran"
      >
        {ports
          .map((port) =>
            port === "true"
              ? tr("automation.outline.true")
              : tr("automation.outline.false"),
          )
          .join(", ")}
      </Badge>
    );
  }
  const look = looks[props.outcome];
  const Icon = look.icon;
  return (
    <Badge
      variant="tint"
      tone={look.tone}
      data-testid={props.testId}
      data-outcome={props.outcome}
    >
      <Icon />
      {look.text}
    </Badge>
  );
};

export default AutomationOutlineOutcome;
