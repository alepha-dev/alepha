import type { AiPendingCallResource } from "alepha/api/ai";
import { useI18n } from "alepha/react/i18n";

import { Button } from "../core/Button.tsx";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "../core/Card.tsx";

export interface AiChatConfirmCardProps {
  /**
   * The call waiting, with the input the SERVER stored: what is shown is
   * what an approval runs.
   */
  pending: AiPendingCallResource;
  loading?: boolean;
  onApprove: () => void;
  onDeny: () => void;
}

/**
 * Asks the user before the assistant runs a mutation. Approving or denying
 * sends the call id only.
 */
export const AiChatConfirmCard = (props: AiChatConfirmCardProps) => {
  const { tr } = useI18n();

  return (
    <Card data-testid="ai-chat-confirm" className="gap-2">
      <CardHeader>
        <CardTitle className="text-sm">
          {tr("ai.chat.confirmTitle", {
            default: "Run $1?",
            args: [props.pending.name],
          })}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <pre className="bg-muted max-h-48 overflow-auto rounded p-2 text-xs">
          {JSON.stringify(props.pending.input, null, 2)}
        </pre>
      </CardContent>
      <CardFooter className="gap-2">
        <Button
          intent="primary"
          disabled={props.loading}
          onClick={() => props.onApprove()}
        >
          {tr("ai.chat.approve", { default: "Approve" })}
        </Button>
        <Button
          variant="outlined"
          disabled={props.loading}
          onClick={() => props.onDeny()}
        >
          {tr("ai.chat.deny", { default: "Deny" })}
        </Button>
      </CardFooter>
    </Card>
  );
};
