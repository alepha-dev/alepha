import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Segmented,
  Textarea,
} from "@alepha/ui";
import { HOST_JOB_WAKE_UP } from "@lore/core/schemas";
import type { I18n } from "@lore/core/web";
import { useI18n } from "alepha/react/i18n";
import { useState } from "react";

export interface ProjectJobPokeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * Sends the message, answering whether it was sent: the dialog closes
   * then, and stays open on a refusal.
   */
  onSend: (message: string) => Promise<boolean>;
  sending?: boolean;
}

type Choice = "wake" | "text";

/**
 * Poke (#Q4456): a message to a running Claude Code job, which its agent
 * reads after the tool call it is running, or at once when it waits on a
 * background task. Two choices, the Wake up preset, shown as the agent will
 * read it, and a member's own words.
 */
const ProjectJobPokeDialog = (props: ProjectJobPokeDialogProps) => {
  const { tr } = useI18n<I18n, "en">();
  const [choice, setChoice] = useState<Choice>("wake");
  const [text, setText] = useState("");

  // Every closing resets it, so the next opening starts on the preset with
  // an empty message.
  const setOpen = (open: boolean) => {
    if (!open) {
      setChoice("wake");
      setText("");
    }
    props.onOpenChange(open);
  };

  const message = choice === "wake" ? HOST_JOB_WAKE_UP : text.trim();

  return (
    <Dialog open={props.open} onOpenChange={setOpen}>
      <DialogContent className="sm:max-w-lg" data-testid="job-poke-dialog">
        <DialogHeader>
          <DialogTitle>{tr("jobs.poke.title")}</DialogTitle>
          <DialogDescription>{tr("jobs.poke.description")}</DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (!message || props.sending) return;
            void props.onSend(message).then((sent) => {
              if (sent) setOpen(false);
            });
          }}
        >
          <Segmented
            options={[
              { value: "wake", label: tr("jobs.poke.wakeUp") },
              { value: "text", label: tr("jobs.poke.message") },
            ]}
            value={choice}
            onChange={(value) => setChoice(value as Choice)}
            fullWidth
            data-testid="job-poke-choice"
          />
          {choice === "wake" ? (
            <p
              className="bg-muted text-muted-foreground rounded-lg px-3 py-2 text-sm"
              data-testid="job-poke-preset"
            >
              {HOST_JOB_WAKE_UP}
            </p>
          ) : (
            <Textarea
              rows={5}
              maxLength={8000}
              value={text}
              placeholder={tr("jobs.poke.placeholder")}
              onChange={(event) => setText(event.currentTarget.value)}
              data-testid="job-poke-text"
            />
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="outlined"
              onClick={() => setOpen(false)}
            >
              {tr("jobs.poke.close")}
            </Button>
            <Button
              type="submit"
              disabled={!message || props.sending}
              data-testid="job-poke-send"
            >
              {tr("jobs.poke.send")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};

export default ProjectJobPokeDialog;
