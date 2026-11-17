import { Alert, AlertDescription } from "@alepha/ui";
import { TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";

export interface WarningNoticeProps {
  children: ReactNode;
  className?: string;
  "data-testid"?: string;
}

/**
 * The one warning band of the Requirements pages (#E153): the kit's `Alert`
 * in the amber the rest of Lore warns with, with its glyph. It replaced four
 * hand-drawn boxes in a yellow of their own.
 */
const WarningNotice = (props: WarningNoticeProps) => (
  <Alert
    data-testid={props["data-testid"]}
    className={`border-amber-500/40 bg-amber-500/10 ${props.className ?? ""}`}
  >
    <TriangleAlert className="text-amber-600 dark:text-amber-500" />
    <AlertDescription className="text-foreground">
      {props.children}
    </AlertDescription>
  </Alert>
);

export default WarningNotice;
