import { Card, CardContent, CardHeader, CardTitle, cn } from "@alepha/ui";
import { useI18n } from "alepha/react/i18n";
import { Check, CircleAlert, CornerDownRight, ListOrdered } from "lucide-react";

import type { I18n } from "../../../../services/I18n.ts";

export interface AutomationOutlineAsideProps {
  /**
   * The automation in words, one sentence per block.
   */
  words: string[];
  /**
   * What is missing before a save; each line opens the row it names.
   */
  checks: AutomationOutlineCheck[];
  onReveal: (node: string) => void;
}

/**
 * One line of "Before you save": what it says, the row it opens, and its
 * tone (a field to fill is a warning, a refusal at Save is an error).
 */
export interface AutomationOutlineCheck {
  node?: string;
  text: string;
  /**
   * What the row it names shows: "To fill: Title" or the issue alone.
   */
  short: string;
  tone: "warning" | "danger";
}

/**
 * The editor's aside (#Q3849): In plain words, Before you save, How it
 * runs. Beside the blocks, below them on a phone.
 */
const AutomationOutlineAside = (props: AutomationOutlineAsideProps) => {
  const { tr } = useI18n<I18n, "en">();
  return (
    <aside
      className="flex flex-col gap-4 lg:sticky lg:top-24 lg:self-start"
      data-testid="automation-outline-aside"
    >
      <Card className="ring-foreground/15 shadow-sm">
        <CardHeader>
          <CardTitle>{tr("automation.outline.words.title")}</CardTitle>
        </CardHeader>
        <CardContent>
          <ul
            className="flex flex-col gap-3 text-sm"
            data-testid="automation-outline-words"
          >
            {props.words.length === 0 && (
              <li className="text-muted-foreground">
                {tr("automation.outline.words.empty")}
              </li>
            )}
            {props.words.map((sentence, index) => (
              <li key={index}>{sentence}</li>
            ))}
          </ul>
        </CardContent>
      </Card>
      <Card className="ring-foreground/15 shadow-sm">
        <CardHeader>
          <CardTitle>{tr("automation.outline.check.title")}</CardTitle>
        </CardHeader>
        <CardContent>
          {props.checks.length === 0 ? (
            <p
              className="text-success-text flex items-center gap-2 text-sm font-medium"
              data-testid="automation-outline-ready"
            >
              <Check className="size-4" />
              {tr("automation.outline.check.none")}
            </p>
          ) : (
            <ul
              className="flex flex-col gap-1.5 text-sm"
              data-testid="automation-outline-checks"
            >
              {props.checks.map((check, index) => (
                <li key={index}>
                  <button
                    type="button"
                    className={cn(
                      "flex items-start gap-2 text-start enabled:cursor-pointer enabled:hover:underline",
                      check.tone === "danger"
                        ? "text-danger-text"
                        : "text-warning-text",
                    )}
                    disabled={!check.node}
                    data-testid="automation-outline-check"
                    data-node={check.node}
                    onClick={() => check.node && props.onReveal(check.node)}
                  >
                    <CircleAlert className="mt-0.5 size-4 shrink-0" />
                    {check.text}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
      <Card className="ring-foreground/15 bg-foreground/[0.03] shadow-none">
        <CardHeader>
          <CardTitle>{tr("automation.outline.how.title")}</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="text-muted-foreground flex flex-col gap-2 text-sm">
            <li className="flex gap-2">
              <ListOrdered className="mt-0.5 size-4 shrink-0" />
              {tr("automation.outline.how.independent")}
            </li>
            <li className="flex gap-2">
              <CornerDownRight className="mt-0.5 size-4 shrink-0" />
              {tr("automation.outline.how.stops")}
            </li>
            <li className="flex gap-2">
              <CircleAlert className="mt-0.5 size-4 shrink-0" />
              {tr("automation.outline.how.decided")}
            </li>
          </ul>
        </CardContent>
      </Card>
    </aside>
  );
};

export default AutomationOutlineAside;
