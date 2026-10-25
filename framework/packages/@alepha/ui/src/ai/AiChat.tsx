import { useForm } from "alepha/react/form";
import { useI18n } from "alepha/react/i18n";

import { Alert, AlertDescription } from "../core/Alert.tsx";
import { Button } from "../core/Button.tsx";
import {
  Drawer,
  DrawerContent,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from "../core/Drawer.tsx";
import { Spinner } from "../core/Spinner.tsx";
import { Control } from "../form/Control.tsx";
import { MarkdownView } from "../markdown/MarkdownView.tsx";
import { AiChatConfirmCard } from "./AiChatConfirmCard.tsx";
import { AiChatHistory } from "./AiChatHistory.tsx";
import { AiChatMessage } from "./AiChatMessage.tsx";
import { aiChatMessageFormSchema } from "./aiChatMessageFormSchema.ts";
import { type UseAiChatOptions, useAiChat } from "./useAiChat.ts";

export interface AiChatProps extends UseAiChatOptions {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * The drawer's title. Defaults to "Assistant".
   */
  title?: string;
  /**
   * Show the list of past conversations. Default true.
   */
  history?: boolean;
}

/**
 * The assistant in a drawer: streamed markdown replies, the conversation
 * history, and a confirmation card for every mutation the assistant wants to
 * run. It knows the page through `useAiContext()`, and runs `navigate` and
 * `fillForm` for the model.
 *
 * Needs `AlephaApiAi` on the server and a `$ai` declared by the app.
 *
 * @example
 * ```tsx
 * const [open, setOpen] = useState(false);
 * <Button onClick={() => setOpen(true)}>Ask</Button>
 * <AiChat open={open} onOpenChange={setOpen} />
 * ```
 */
export const AiChat = (props: AiChatProps) => {
  const { tr } = useI18n();
  const chat = useAiChat(props);
  const form = useForm(
    {
      schema: aiChatMessageFormSchema,
      handler: async (values) => {
        form.reset();
        await chat.send(values.message);
      },
    },
    [chat.send],
  );

  return (
    <Drawer
      open={props.open}
      onOpenChange={(open) => props.onOpenChange(open)}
      swipeDirection="right"
    >
      <DrawerContent
        data-testid="ai-chat"
        className="flex h-full w-full flex-col sm:max-w-md"
      >
        <DrawerHeader>
          <DrawerTitle>
            {props.title ?? tr("ai.chat.title", { default: "Assistant" })}
          </DrawerTitle>
        </DrawerHeader>
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4">
          {props.history !== false && (
            <AiChatHistory
              current={chat.conversationId}
              disabled={chat.loading}
              onOpen={(id) => chat.open(id)}
            />
          )}
          {chat.items.length === 0 && !chat.streaming && (
            <p className="text-muted-foreground text-sm">
              {tr("ai.chat.empty", {
                default: "Ask anything about this page.",
              })}
            </p>
          )}
          <div className="flex flex-col gap-2">
            {chat.items.map((item) => (
              <AiChatMessage key={item.id} item={item} />
            ))}
            {chat.streaming && (
              <div data-testid="ai-chat-streaming" className="mr-8 self-start">
                <MarkdownView content={chat.streaming} />
              </div>
            )}
            {chat.activity && (
              <div className="text-muted-foreground flex items-center gap-2 text-xs">
                <Spinner />
                {tr("ai.chat.running", {
                  default: "Running $1",
                  args: [chat.activity],
                })}
              </div>
            )}
          </div>
          {chat.pending?.kind === "confirm" && (
            <AiChatConfirmCard
              pending={chat.pending}
              loading={chat.loading}
              onApprove={() => chat.approve()}
              onDeny={() => chat.deny()}
            />
          )}
          {chat.error && (
            <Alert variant="destructive" data-testid="ai-chat-error">
              <AlertDescription>{chat.error}</AlertDescription>
            </Alert>
          )}
        </div>
        <DrawerFooter>
          <form {...form.props} className="flex flex-col gap-2">
            <Control
              input={form.input.message}
              area
              rows={3}
              label={tr("ai.chat.message", { default: "Message" })}
              placeholder={tr("ai.chat.placeholder", {
                default: "Ask the assistant",
              })}
            />
            <Button
              type="submit"
              intent="primary"
              disabled={chat.loading || Boolean(chat.pending)}
            >
              {chat.loading && <Spinner />}
              {tr("ai.chat.send", { default: "Send" })}
            </Button>
          </form>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
};
