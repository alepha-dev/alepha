import { useI18n } from "alepha/react/i18n";
import { Sparkles } from "lucide-react";
import type { ReactNode } from "react";

/**
 * A question the empty drawer offers, sent as is on click.
 */
export interface AiChatSuggestion {
  /**
   * What the button says.
   */
  label: string;
  /**
   * What is sent, when it differs from the label.
   */
  prompt?: string;
  icon?: ReactNode;
}

export interface AiChatEmptyProps {
  suggestions?: AiChatSuggestion[];
  disabled?: boolean;
  onPick: (prompt: string) => void;
}

/**
 * What a new conversation opens on: what the assistant is for, and a few
 * questions to start from.
 */
export const AiChatEmpty = (props: AiChatEmptyProps) => {
  const { tr } = useI18n();

  return (
    <div
      data-testid="ai-chat-empty"
      className="mt-auto flex flex-col gap-3 pb-2"
    >
      <div className="bg-primary/10 text-primary flex size-9 items-center justify-center rounded-full">
        <Sparkles className="size-4" />
      </div>
      <div className="flex flex-col gap-1">
        <p className="text-base font-medium">
          {tr("ai.chat.emptyTitle", { default: "What do you want to do?" })}
        </p>
        <p className="text-muted-foreground text-sm leading-relaxed">
          {tr("ai.chat.empty", { default: "Ask anything about this page." })}
        </p>
      </div>
      {props.suggestions && props.suggestions.length > 0 && (
        <div className="flex flex-col gap-1.5">
          {props.suggestions.map((suggestion) => (
            <button
              key={suggestion.label}
              type="button"
              disabled={props.disabled}
              onClick={() =>
                props.onPick(suggestion.prompt ?? suggestion.label)
              }
              className="border-border hover:bg-muted hover:border-foreground/20 focus-visible:ring-ring/50 flex items-center gap-2.5 rounded-lg border px-3 py-2 text-left text-sm transition-colors outline-none focus-visible:ring-3 disabled:opacity-50"
            >
              {suggestion.icon && (
                <span className="text-muted-foreground shrink-0 [&_svg]:size-4">
                  {suggestion.icon}
                </span>
              )}
              <span>{suggestion.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};
