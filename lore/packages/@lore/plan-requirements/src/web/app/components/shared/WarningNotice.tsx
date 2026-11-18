import { Alert, AlertAction, AlertDescription, Button } from "@alepha/ui";
import type { I18n } from "@lore/core/web";
import { useI18n } from "alepha/react/i18n";
import { TriangleAlert, X } from "lucide-react";
import type { ReactNode } from "react";

export interface WarningNoticeProps {
  children: ReactNode;
  className?: string;
  "data-testid"?: string;
  /**
   * Draws a cross that hides the band. The caller owns whether it shows, so
   * hiding lasts as long as the caller's state: nothing is remembered.
   */
  onDismiss?: () => void;
}

/**
 * The one warning band of the Requirements pages (#E153): the kit's `Alert`
 * in the amber the rest of Lore warns with, with its glyph. It replaced four
 * hand-drawn boxes in a yellow of their own.
 */
const WarningNotice = (props: WarningNoticeProps) => {
  const { tr } = useI18n<I18n, "en">();
  return (
    <Alert
      data-testid={props["data-testid"]}
      className={`border-amber-500/40 bg-amber-500/10 ${props.className ?? ""}`}
    >
      <TriangleAlert className="text-amber-600 dark:text-amber-500" />
      <AlertDescription className="text-foreground">
        {props.children}
      </AlertDescription>
      {props.onDismiss ? (
        <AlertAction className="top-1.5">
          <Button
            variant="minimal"
            size="icon-xs"
            aria-label={tr("common.close")}
            title={tr("common.close")}
            onClick={props.onDismiss}
          >
            <X />
          </Button>
        </AlertAction>
      ) : null}
    </Alert>
  );
};

export default WarningNotice;
