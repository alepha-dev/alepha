import { Segmented } from "@alepha/ui";
import { DateTimeProvider } from "alepha/datetime";
import { useAction, useAlepha, useClient, useInject } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { BellOff, BellRing } from "lucide-react";

import type { QuestController } from "@/api/controllers/QuestController.ts";
import type { ReminderInterval } from "@/api/entities/quests.ts";
import type { QuestResource } from "@/api/schemas/questResourceSchema.ts";
import { currentAssignedQuestsAtom } from "@/web/app/atoms/currentAssignedQuestsAtom.ts";
import type { I18n } from "@/web/app/services/I18n.ts";

export interface QuestViewSettingsProps {
  quest: QuestResource;
  onUpdate: (quest: QuestResource) => void;
}

type ReminderPresetKey = "off" | ReminderInterval;

interface ReminderPreset {
  key: ReminderPresetKey;
  labelKey:
    | "quest.view.reminder.off"
    | "quest.view.reminder.daily"
    | "quest.view.reminder.weekly"
    | "quest.view.reminder.monthly";
  interval: ReminderInterval | null;
}

const REMINDER_PRESETS: ReminderPreset[] = [
  { key: "off", labelKey: "quest.view.reminder.off", interval: null },
  { key: "daily", labelKey: "quest.view.reminder.daily", interval: "daily" },
  { key: "weekly", labelKey: "quest.view.reminder.weekly", interval: "weekly" },
  {
    key: "monthly",
    labelKey: "quest.view.reminder.monthly",
    interval: "monthly",
  },
];

const QuestViewSettings = (props: QuestViewSettingsProps) => {
  const { tr } = useI18n<I18n, "en">();
  const client = useClient<QuestController>();
  const alepha = useAlepha();
  const dateTime = useInject(DateTimeProvider);

  const propagate = (updated: QuestResource) => {
    props.onUpdate(updated);
    const list = alepha.store.get(currentAssignedQuestsAtom) ?? [];
    alepha.store.set(
      currentAssignedQuestsAtom,
      list.map((q) => (q.id === updated.id ? updated : q)),
    );
  };

  // A `useAction` (#E59, #Q2328): a refused change is the server's sentence,
  // toasted by the root `ActionErrorToaster`, where it used to be an
  // unhandled rejection, and the control waits while it runs.
  const reminderAction = useAction<[key: string], void>(
    {
      handler: async (key) => {
        const preset = REMINDER_PRESETS.find((p) => p.key === key);
        if (!preset) return;
        const updated = await client.setQuestReminder({
          params: { id: props.quest.id },
          body: { interval: preset.interval },
        });
        propagate(updated);
      },
    },
    [client, props.quest.id, props.onUpdate],
  );

  const activePreset =
    REMINDER_PRESETS.find(
      (p) => p.interval === (props.quest.reminderInterval ?? null),
    ) ?? REMINDER_PRESETS[0];

  const nextLabel =
    props.quest.reminderNextAt && props.quest.reminderInterval
      ? tr("quest.view.reminder.next", {
          args: [dateTime.of(props.quest.reminderNextAt).fromNow()],
        })
      : tr("quest.view.reminder.none");

  const canEditReminder =
    !!props.quest.acceptedAt &&
    !props.quest.completedAt &&
    client.setQuestReminder.can();

  // Nothing at all when the reminder cannot be set (#Q2424). It used to draw
  // the heading and a sentence saying why, a whole block on every unassigned
  // quest that offered nothing to do.
  if (!canEditReminder) {
    return null;
  }

  return (
    // Ruled off from the tags above. The border lives here rather than on a
    // wrapper at the call site for the reason `QuestViewRailTags` gives:
    // this returns `null`, and a wrapper would leave the rule behind.
    <div className="flex flex-col gap-2 border-t px-1 pt-4">
      <div className="flex items-center gap-1.5">
        {activePreset.key === "off" ? (
          <BellOff className="text-muted-foreground size-3.5" />
        ) : (
          <BellRing className="size-3.5 text-amber-500" />
        )}
        <span className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
          {tr("quest.view.reminder.title")}
        </span>
      </div>
      <Segmented
        size="sm"
        fullWidth
        value={activePreset.key}
        disabled={reminderAction.loading}
        onChange={(key) => void reminderAction.run(key)}
        options={REMINDER_PRESETS.map((preset) => ({
          value: preset.key,
          label: tr(preset.labelKey),
        }))}
      />
      <p className="text-muted-foreground text-xs">{nextLabel}</p>
    </div>
  );
};

export default QuestViewSettings;
