import { Tooltip, TooltipContent, TooltipTrigger } from "@alepha/ui";
import type { I18n } from "@lore/core/web";
import { useI18n } from "alepha/react/i18n";
import { CircleCheck, TriangleAlert } from "lucide-react";

export interface ErrorTrustIconProps {
  trusted: boolean;
  /**
   * The member who trusted the group, when it is trusted.
   */
  trustedByName?: string;
  /**
   * Trusted on arrival as a server error (#Q4255), by no member.
   */
  onArrival?: boolean;
}

/**
 * An error group's trust state (#Q4233) as an icon with a tooltip (#Q4242):
 * a green check naming the member who trusted it, or an orange warning
 * saying a member must approve it before an agent processes it. A server
 * group trusted on arrival (#Q4255) shows the check with no member's name.
 */
const ErrorTrustIcon = (props: ErrorTrustIconProps) => {
  const { tr } = useI18n<I18n, "en">();
  const label = !props.trusted
    ? tr("errors.untrustedHint")
    : props.onArrival
      ? tr("errors.trustedOnArrival")
      : tr("errors.trustedBy", { args: [props.trustedByName ?? ""] });
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            className="inline-flex"
            role="img"
            aria-label={label}
            data-testid={props.trusted ? "error-trusted" : "error-untrusted"}
          />
        }
      >
        {props.trusted ? (
          <CircleCheck className="text-success size-4" />
        ) : (
          <TriangleAlert className="text-warning size-4" />
        )}
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
};

export default ErrorTrustIcon;
