import { Alert, AlertDescription, AlertTitle, Button } from "@alepha/ui";
import { useI18n } from "alepha/react/i18n";
import { CircleAlert, Trash2 } from "lucide-react";

import type { I18n } from "../../../../services/I18n.ts";

export interface AutomationOutlineNoticeProps {
  /**
   * Why the graph is not an outline, as the validator says it.
   */
  reason: string;
  /**
   * Deletes the automation; absent, the viewer may not.
   */
  onDelete?: () => void;
  busy?: boolean;
}

/**
 * In place of the outline, for a stored graph the outline rules refuse
 * (#Q3847, decision 8 of folio F1524): it is not converted, it is rebuilt.
 */
const AutomationOutlineNotice = (props: AutomationOutlineNoticeProps) => {
  const { tr } = useI18n<I18n, "en">();
  return (
    <Alert data-testid="automation-outline-notice">
      <CircleAlert />
      <AlertTitle>{tr("automation.outline.notOutline.title")}</AlertTitle>
      <AlertDescription className="flex flex-col items-start gap-3">
        <span>{tr("automation.outline.notOutline.description")}</span>
        <span className="text-muted-foreground text-xs">{props.reason}</span>
        {props.onDelete && (
          <Button
            variant="outlined"
            intent="danger"
            size="sm"
            disabled={props.busy}
            onClick={props.onDelete}
          >
            <Trash2 className="size-4" />
            {tr("automation.delete")}
          </Button>
        )}
      </AlertDescription>
    </Alert>
  );
};

export default AutomationOutlineNotice;
