import { Button, Switch } from "@alepha/ui";
import { SettingsRow, SettingsSection } from "@alepha/ui/settings";
import type { PromptResource } from "@lore/core/schemas";
import type { I18n } from "@lore/core/web";
import { useI18n } from "alepha/react/i18n";
import { Clock, FileCode, Pencil, Pin } from "lucide-react";

export interface ProjectPromptSettingsProps {
  prompt: PromptResource;
  pages: Array<{ key: string; label: string }>;
  busy: boolean;
  onPins: () => void;
  onTrigger: () => void;
  onSwitch: (enabled: boolean) => void;
  onEditor: (mode: "edit" | "source") => void;
}

/**
 * A prompt's Settings tab (#Q4355), for `prompt:manage`: where it is pinned,
 * its trigger with its on/off switch, and its words (Edit for a custom
 * prompt, Source for a built-in), each opening the dialog the toolbar used
 * to.
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
          label={tr("prompts.settings.text")}
          description={tr(
            prompt.builtin
              ? "prompts.settings.text.builtin"
              : "prompts.settings.text.custom",
          )}
        >
          {prompt.builtin ? (
            <Button
              variant="outlined"
              disabled={props.busy}
              onClick={() => props.onEditor("source")}
            >
              <FileCode className="size-4" />
              {tr("prompts.source")}
            </Button>
          ) : (
            <Button
              variant="outlined"
              disabled={props.busy}
              onClick={() => props.onEditor("edit")}
            >
              <Pencil className="size-4" />
              {tr("prompts.edit")}
            </Button>
          )}
        </SettingsRow>
      </SettingsSection>
    </div>
  );
};

export default ProjectPromptSettings;
