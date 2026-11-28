import type { AiPendingCallResource } from "alepha/api/ai";
import { useI18n } from "alepha/react/i18n";
import { useState } from "react";

import { Button } from "../core/Button.tsx";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "../core/Card.tsx";
import { AiChatConfirmFields } from "./AiChatConfirmFields.tsx";

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
 * Asks the user before the assistant runs a mutation, its input as a list of
 * fields. Approving or denying sends the call id only.
 *
 * An app replaces it for one tool with `AiChat`'s `confirmCards`, and gets
 * the same props.
 */
export const AiChatConfirmCard = (props: AiChatConfirmCardProps) => {
  const { tr } = useI18n();
  // `loading` is the chat's: the button the user pressed is the one that spins.
  const [choice, setChoice] = useState<"approve" | "deny">();

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
      {/* Capped and scrolling on its own: a long input drawn at full height
          pushes the conversation away, and the buttons with it. The footer
          sits outside, so Approve and Deny always show. */}
      <CardContent
        className="max-h-80 overflow-y-auto"
        data-testid="ai-chat-confirm-body"
      >
        <AiChatConfirmFields input={props.pending.input} />
      </CardContent>
      <CardFooter className="gap-2">
        <Button
          intent="primary"
          disabled={props.loading}
          loading={props.loading && choice === "approve"}
          onClick={() => {
            setChoice("approve");
            props.onApprove();
          }}
        >
          {tr("ai.chat.approve", { default: "Approve" })}
        </Button>
        <Button
          variant="outlined"
          disabled={props.loading}
          loading={props.loading && choice === "deny"}
          onClick={() => {
            setChoice("deny");
            props.onDeny();
          }}
        >
          {tr("ai.chat.deny", { default: "Deny" })}
        </Button>
      </CardFooter>
    </Card>
  );
};
