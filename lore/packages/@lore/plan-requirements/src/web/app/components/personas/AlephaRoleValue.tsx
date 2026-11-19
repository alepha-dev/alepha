import { Badge } from "@alepha/ui";
import { ShieldUser } from "lucide-react";

import { alephaRoleLabel } from "./alephaRoleLabel.ts";

export interface AlephaRoleValueProps {
  role: string;
}

/**
 * A persona's Alepha role on its page (#Q3960): an identifier as the
 * humanized badge the card shows, a sentence as plain text that wraps,
 * never a code chip.
 */
const AlephaRoleValue = (props: AlephaRoleValueProps) => {
  const label = alephaRoleLabel(props.role);
  if (label.kind === "badge") {
    return (
      <Badge
        variant="outline"
        title={props.role}
        data-testid="persona-alepha-role"
      >
        <ShieldUser className="size-3" />
        {label.label}
      </Badge>
    );
  }
  return (
    <span className="text-sm break-words" data-testid="persona-alepha-role">
      {label.text}
    </span>
  );
};

export default AlephaRoleValue;
