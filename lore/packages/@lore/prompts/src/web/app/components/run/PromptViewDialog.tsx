import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@alepha/ui";
import type { PromptResource } from "@lore/core/schemas";
import type { I18n } from "@lore/core/web";
import { useI18n } from "alepha/react/i18n";

export interface PromptViewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  prompt: PromptResource;
}

/**
 * A prompt's words, read-only (#Q4280): a built-in's are Lore's, and its
 * args with the statuses each accepts.
 */
const PromptViewDialog = (props: PromptViewDialogProps) => {
  const { tr } = useI18n<I18n, "en">();
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="sm:max-w-3xl" data-testid="prompt-view">
        <DialogHeader>
          <DialogTitle>{props.prompt.title}</DialogTitle>
          <DialogDescription>{props.prompt.description}</DialogDescription>
        </DialogHeader>
        {props.prompt.args.length > 0 && (
          <ul className="text-muted-foreground text-xs">
            {props.prompt.args.map((arg) => (
              <li key={arg.name}>
                {`{{${arg.name}.*}}`} {tr(`prompts.arg.${arg.type}`)}
                {arg.accepts?.length
                  ? ` (${tr("prompts.accepts", { args: [arg.accepts.join(", ")] })})`
                  : ""}
              </li>
            ))}
          </ul>
        )}
        <pre className="bg-card max-h-[60vh] overflow-auto rounded border p-3 text-xs whitespace-pre-wrap">
          {props.prompt.text}
        </pre>
      </DialogContent>
    </Dialog>
  );
};

export default PromptViewDialog;
