import { Button } from "@alepha/ui/components/ui/button";
import { Textarea } from "@alepha/ui/components/ui/textarea";
import { useDialog } from "@alepha/ui/components/use-dialog/use-dialog";
import { useToast } from "@alepha/ui/components/use-toast/use-toast";
import { useI18n } from "alepha/react/i18n";
import { useRef, useState } from "react";

import type { AgentPromptKind } from "@/api/schemas/agentPromptKindSchema.ts";
import { AGENT_PROMPT_DEFAULTS } from "@/web/app/prompts/agentPromptDefaults.ts";
import type { I18n } from "@/web/app/services/I18n.ts";

/**
 * Past this, the editor shows how much of the cap is left. Below it the
 * counter is noise: the defaults run to about 3 000 characters, so a number
 * on screen at all times would only ever say "you have plenty".
 */
const COUNTER_THRESHOLD = 15_000;

/**
 * The schema's own cap, restated here only to render the denominator. The
 * server is what enforces it.
 */
const TEMPLATE_MAX = 20_000;

export interface ProjectSettingsAgentPromptEditorProps {
  kind: AgentPromptKind;
  /** The stored template, or `undefined` while this kind follows the default. */
  stored: string | undefined;
  onSave: (kind: AgentPromptKind, template: string) => Promise<void>;
  onReset: (kind: AgentPromptKind) => Promise<void>;
}

/**
 * One prompt template, editable.
 *
 * ⚠️ **Reset deletes the row rather than writing the default into the box.**
 * That is what keeps a reset project following the shipped text as it
 * improves, and it is why Reset is offered only while a stored row exists:
 * on a kind that already follows the default there is nothing to reset.
 */
export const ProjectSettingsAgentPromptEditor = (
  props: ProjectSettingsAgentPromptEditorProps,
) => {
  const { tr } = useI18n<I18n, "en">();
  const toaster = useToast();
  const dialog = useDialog();
  const fallback = AGENT_PROMPT_DEFAULTS[props.kind];
  const persisted = props.stored ?? fallback;
  const [text, setText] = useState(persisted);
  const [pending, setPending] = useState(false);

  /**
   * Re-seed when the STORED value changes, and never on every render.
   *
   * Adjusted during render rather than in an effect, the pattern the
   * epic-review dialog documented before this replaced it: an effect that
   * seeds on every change fights the owner's own typing, and one that seeds
   * on mount alone never sees a save or a reset land.
   */
  const seededRef = useRef<string>(persisted);
  if (seededRef.current !== persisted) {
    seededRef.current = persisted;
    setText(persisted);
  }

  const trimmedEmpty = text.trim().length === 0;
  const dirty = text !== persisted;

  const save = async () => {
    setPending(true);
    try {
      await props.onSave(props.kind, text);
      toaster.success(tr("agentPrompts.settings.saved"));
    } catch (error) {
      toaster.error(error instanceof Error ? error.message : String(error));
    } finally {
      setPending(false);
    }
  };

  const reset = async () => {
    const confirmed = await dialog.confirm({
      title: String(tr("agentPrompts.settings.reset.title")),
      description: String(tr("agentPrompts.settings.reset.description")),
      confirmLabel: String(tr("agentPrompts.settings.reset")),
      destructive: true,
    });
    if (!confirmed) return;

    setPending(true);
    try {
      await props.onReset(props.kind);
      toaster.success(tr("agentPrompts.settings.wasReset"));
    } catch (error) {
      toaster.error(error instanceof Error ? error.message : String(error));
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="flex flex-col gap-2" data-testid={`prompt-${props.kind}`}>
      <div className="flex flex-col gap-1">
        <span className="text-sm font-medium">
          {tr(`agentPrompts.settings.${props.kind}.title` as never)}
        </span>
        <span className="text-muted-foreground text-xs">
          {tr(`agentPrompts.settings.${props.kind}.description` as never)}
        </span>
      </div>

      <Textarea
        value={text}
        rows={10}
        disabled={pending}
        spellCheck={false}
        className="font-mono text-xs"
        aria-label={String(
          tr(`agentPrompts.settings.${props.kind}.title` as never),
        )}
        data-testid={`prompt-input-${props.kind}`}
        onChange={(e) => setText(e.currentTarget.value)}
      />

      <div className="flex items-center gap-2">
        <Button
          size="sm"
          // ⚠️ Empty is refused here rather than sent to be refused: the
          // column is `.min(1)`, and a Save that always 400s is a button
          // that lies about what it does.
          disabled={pending || !dirty || trimmedEmpty}
          onClick={save}
        >
          {tr("agentPrompts.settings.save")}
        </Button>
        {props.stored !== undefined && (
          <Button
            size="sm"
            variant="outline"
            disabled={pending}
            onClick={reset}
            data-testid={`prompt-reset-${props.kind}`}
          >
            {tr("agentPrompts.settings.reset")}
          </Button>
        )}
        {text.length > COUNTER_THRESHOLD && (
          <span className="text-muted-foreground ml-auto text-xs tabular-nums">
            {text.length} / {TEMPLATE_MAX}
          </span>
        )}
      </div>
    </div>
  );
};
