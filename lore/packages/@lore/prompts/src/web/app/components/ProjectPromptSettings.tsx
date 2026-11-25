import { Button, Switch } from "@alepha/ui";
import { Control } from "@alepha/ui/form";
import { SettingsRow, SettingsSection } from "@alepha/ui/settings";
import type { PromptResource } from "@lore/core/schemas";
import type { I18n } from "@lore/core/web";
import { z } from "alepha";
import { useForm } from "alepha/react/form";
import { useI18n } from "alepha/react/i18n";
import { Clock, Pin } from "lucide-react";
import { useRef } from "react";

export interface ProjectPromptSettingsProps {
  prompt: PromptResource;
  pages: Array<{ key: string; label: string }>;
  busy: boolean;
  onPins: () => void;
  onTrigger: () => void;
  onSwitch: (enabled: boolean) => void;
  /**
   * Saves the source the select was set to, and says whether the server
   * took it: a refused one puts the select back.
   */
  onSource: (source: PromptResource["source"]) => Promise<boolean>;
}

/**
 * A prompt's Settings tab (#Q4355), for `prompt:manage`: where it is pinned,
 * its trigger with its on/off switch, and its source, a select saved on
 * change for a built-in and a custom prompt alike (#Q4409). A custom
 * prompt's words are edited from the toolbar's Edit.
 */
const ProjectPromptSettings = (props: ProjectPromptSettingsProps) => {
  const { tr } = useI18n<I18n, "en">();
  const { prompt } = props;
  const triggered = prompt.on !== "manual";
  const pins = prompt.pins.length
    ? prompt.pins
        .map((key) =>
          tr(`prompts.page.${key}`, {
            default: props.pages.find((it) => it.key === key)?.label ?? key,
          }),
        )
        .join(", ")
    : tr("prompts.pins.none");
  const trigger = triggered
    ? [
        prompt.on,
        prompt.check?.length
          ? tr("prompts.trigger.checks", { args: [prompt.check.join(", ")] })
          : "",
      ]
        .filter(Boolean)
        .join(" · ")
    : tr("prompts.trigger.manual");
  // The last source the server took, ahead of the refetch that brings it
  // back on `prompt`: a second pick made before that refetch lands is
  // compared with it, not with the stale prop, so it is never dropped.
  const taken = useRef(prompt.source);
  const seen = useRef(prompt.source);
  if (seen.current !== prompt.source) {
    seen.current = prompt.source;
    taken.current = prompt.source;
  }
  const form = useForm(
    {
      schema: z.object({ source: z.enum(["none", "read", "write"]) }),
      initialValues: { source: prompt.source },
      // Picking a row is the write: there is nothing to submit beside it.
      keepDirty: false,
      handler: async () => {},
      onChange: (_key, value) => {
        const next = value as PromptResource["source"];
        if (next === taken.current) return;
        void props.onSource(next).then((saved) => {
          if (saved) taken.current = next;
          // A refused source puts the select back on the one in force.
          else form.input.source.set(taken.current);
        });
      },
    },
    [prompt.name, prompt.source],
  );

  return (
    <div
      className="flex min-h-0 flex-1 flex-col gap-6 overflow-auto p-4"
      data-testid="prompt-page-settings"
    >
      <SettingsSection>
        <SettingsRow
          label={tr("prompts.table.pins")}
          description={<span data-testid="prompt-settings-pins">{pins}</span>}
        >
          <Button
            variant="outlined"
            disabled={props.busy}
            onClick={props.onPins}
          >
            <Pin className="size-4" />
            {tr("prompts.pin")}
          </Button>
        </SettingsRow>
        <SettingsRow
          label={tr("prompts.table.trigger")}
          description={
            <span data-testid="prompt-settings-trigger">{trigger}</span>
          }
        >
          <span className="flex items-center gap-3">
            {triggered && (
              <Switch
                checked={prompt.enabled}
                disabled={props.busy}
                onCheckedChange={(value) => props.onSwitch(value)}
                aria-label={tr(
                  prompt.enabled
                    ? "prompts.trigger.disable"
                    : "prompts.trigger.enable",
                )}
                data-testid="prompt-page-switch"
              />
            )}
            <Button
              variant="outlined"
              disabled={props.busy}
              onClick={props.onTrigger}
            >
              <Clock className="size-4" />
              {tr("prompts.trigger")}
            </Button>
          </span>
        </SettingsRow>
        <SettingsRow
          label={tr("prompts.source")}
          description={tr("prompts.source.description")}
        >
          <Control
            select
            input={form.input.source}
            label=""
            disabled={props.busy}
            triggerClassName="w-full sm:w-48"
            inputProps={{
              "aria-label": tr("prompts.source"),
              "data-testid": "prompt-settings-source",
            }}
            items={[
              { value: "none", label: tr("prompts.source.none") },
              { value: "read", label: tr("prompts.source.read") },
              { value: "write", label: tr("prompts.source.write") },
            ]}
          />
        </SettingsRow>
      </SettingsSection>
    </div>
  );
};

export default ProjectPromptSettings;
