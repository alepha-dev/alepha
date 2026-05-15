import { Button } from "@alepha/ui/components/ui/button";
import { Textarea } from "@alepha/ui/components/ui/textarea";
import { DateTimeProvider } from "alepha/datetime";
import { useAlepha, useClient, useInject } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { BellOff, BellRing } from "lucide-react";
import { useEffect, useState } from "react";
import type { QuestController } from "@/api/controllers/QuestController.ts";
import type { QuestResource } from "@/api/schemas/questResourceSchema.ts";
import { currentAssignedQuestsAtom } from "@/web/app/atoms/currentAssignedQuestsAtom.ts";
import type { I18n } from "@/web/app/services/I18n.ts";

export interface QuestViewSettingsProps {
  quest: QuestResource;
  onUpdate: (quest: QuestResource) => void;
}

interface ReminderPreset {
  key: "off" | "daily" | "weekly" | "hourly";
  labelKey:
    | "quest.view.reminder.off"
    | "quest.view.reminder.daily"
    | "quest.view.reminder.weekly"
    | "quest.view.reminder.hourly";
  intervalMs: number | null;
}

const REMINDER_PRESETS: ReminderPreset[] = [
  { key: "off", labelKey: "quest.view.reminder.off", intervalMs: null },
  {
    key: "hourly",
    labelKey: "quest.view.reminder.hourly",
    intervalMs: 60 * 60 * 1000,
  },
  {
    key: "daily",
    labelKey: "quest.view.reminder.daily",
    intervalMs: 24 * 60 * 60 * 1000,
  },
  {
    key: "weekly",
    labelKey: "quest.view.reminder.weekly",
    intervalMs: 7 * 24 * 60 * 60 * 1000,
  },
];

const QuestViewSettings = (props: QuestViewSettingsProps) => {
  const { tr } = useI18n<I18n, "en">();
  const client = useClient<QuestController>();
  const alepha = useAlepha();
  const dateTime = useInject(DateTimeProvider);

  const [noteText, setNoteText] = useState(props.quest.note ?? "");
  const [noteSaving, setNoteSaving] = useState(false);
  const [reminderSaving, setReminderSaving] = useState(false);

  // Keep the note textarea in sync if the quest reloads externally
  // (e.g. another tab edits it).
  useEffect(() => {
    setNoteText(props.quest.note ?? "");
  }, [props.quest.note]);

  const propagate = (updated: QuestResource) => {
    props.onUpdate(updated);
    const list = alepha.store.get(currentAssignedQuestsAtom) ?? [];
    alepha.store.set(
      currentAssignedQuestsAtom,
      list.map((q) => (q.id === updated.id ? updated : q)),
    );
  };

  const handleNoteSave = async () => {
    if (noteText === (props.quest.note ?? "")) return;
    setNoteSaving(true);
    try {
      const updated = await client.updateQuestNote({
        params: { id: props.quest.id },
        body: { note: noteText },
      });
      propagate(updated);
    } finally {
      setNoteSaving(false);
    }
  };

  const handleReminderPick = async (preset: ReminderPreset) => {
    setReminderSaving(true);
    try {
      const updated = await client.setQuestReminder({
        params: { id: props.quest.id },
        body: { intervalMs: preset.intervalMs },
      });
      propagate(updated);
    } finally {
      setReminderSaving(false);
    }
  };

  const activePreset =
    REMINDER_PRESETS.find(
      (p) => p.intervalMs === (props.quest.reminderIntervalMs ?? null),
    ) ?? REMINDER_PRESETS[0];

  const nextLabel =
    props.quest.reminderNextAt && props.quest.reminderIntervalMs
      ? tr("quest.view.reminder.next", {
          args: [dateTime.of(props.quest.reminderNextAt).fromNow()],
        })
      : tr("quest.view.reminder.none");

  const canEditReminder = !!props.quest.acceptedAt && !props.quest.completedAt;
  const canEditNote = client.updateQuestNote.can();

  return (
    <div className="flex flex-col gap-5 px-1">
      {/* Reminder */}
      <section className="flex flex-col gap-2">
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
            <div className="flex flex-wrap gap-1">
              {REMINDER_PRESETS.map((preset) => (
                <Button
                  key={preset.key}
                  type="button"
                  size="xs"
                  variant={preset === activePreset ? "default" : "outline"}
                  disabled={reminderSaving}
                  onClick={() => handleReminderPick(preset)}
                >
                  {tr(preset.labelKey)}
                </Button>
              ))}
            </div>
            <p className="text-muted-foreground text-xs">{nextLabel}</p>
          </>
        )}
      </section>

      {/* Note (moved from header icon button per Lore #42) */}
      {canEditNote && (
        <section className="flex flex-col gap-2">
          <div className="flex items-center gap-1.5">
            <span className="text-muted-foreground text-xs font-medium uppercase tracking-wide">
              {tr("quest.view.notes")}
            </span>
          </div>
          <Textarea
            placeholder={String(tr("quest.view.notes.placeholder"))}
            value={noteText}
            onChange={(e) => setNoteText(e.target.value)}
            rows={5}
          />
          <div className="flex justify-end">
            <Button
              type="button"
              size="xs"
              variant="outline"
              disabled={noteSaving || noteText === (props.quest.note ?? "")}
              onClick={handleNoteSave}
            >
              {tr("quest.view.notes.save")}
            </Button>
          </div>
        </section>
      )}
    </div>
  );
};

export default QuestViewSettings;
