import { Segmented } from "@alepha/ui/components/ui/segmented";
import { DateTimeProvider } from "alepha/datetime";
import { useAlepha, useClient, useInject } from "alepha/react";
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

  const handleReminderPick = async (key: string) => {
    const preset = REMINDER_PRESETS.find((p) => p.key === key);
    if (!preset) return;
    const updated = await client.setQuestReminder({
      params: { id: props.quest.id },
      body: { interval: preset.interval },
    });
    propagate(updated);
  };

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

  const canEditReminder = !!props.quest.acceptedAt && !props.quest.completedAt;

  return (
    <div className="flex flex-col gap-2 px-1">
      <div className="flex items-center gap-1.5">
        {activePreset.key === "off" ? (
          <BellOff className="text-muted-foreground size-3.5" />
        ) : (
          <BellRing className="size-3.5 text-amber-500" />
        )}
        <span className="text-muted-foreground text-xs font-medium uppercase tracking-wide">
          {tr("quest.view.reminder.title")}
        </span>
      </div>
      {!canEditReminder ? (
        <p className="text-muted-foreground text-xs italic">
          {tr("quest.view.reminder.unavailable")}
        </p>
      ) : (
        <>
          <Segmented
            size="sm"
            fullWidth
            value={activePreset.key}
            onChange={handleReminderPick}
            options={REMINDER_PRESETS.map((preset) => ({
              value: preset.key,
              label: tr(preset.labelKey),
            }))}
          />
          <p className="text-muted-foreground text-xs">{nextLabel}</p>
        </>
      )}
    </div>
  );
};

export default QuestViewSettings;
