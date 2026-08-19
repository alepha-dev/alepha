import { Button } from "@alepha/ui/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@alepha/ui/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@alepha/ui/components/ui/popover";
import { useClient } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { Plus } from "lucide-react";
import { useEffect, useState } from "react";
import type { QuestController } from "@/api/controllers/QuestController.ts";
import type { QuestResource } from "@/api/schemas/questResourceSchema.ts";
import type { I18n } from "@/web/app/services/I18n.ts";

export interface EpicQuestPickerProps {
  projectId: number;
  /** Quest ids already attached to this epic — excluded from the list. */
  attachedIds: Set<number>;
  onAttach: (questId: number) => void;
}

/**
 * Searchable popover that attaches a project quest to the epic. Lists every
 * project quest, `includePlanned: true` so a quest filed under a different
 * (possibly planned) epic still shows up — attaching moves it here, mirroring
 * `EpicController.attachQuest`, which reassigns `epicId` unconditionally
 * rather than refusing an already-attached quest.
 */
const EpicQuestPicker = (props: EpicQuestPickerProps) => {
  const { tr } = useI18n<I18n, "en">();
  const questApi = useClient<QuestController>();
  const [open, setOpen] = useState(false);
  const [quests, setQuests] = useState<QuestResource[]>([]);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    questApi
      .getQuests({
        params: { projectId: props.projectId },
        // `size` is capped at 100 server-side; for larger projects the
        // combobox search narrows the list (same known limitation as
        // `QuestDependencyPicker`).
        query: { size: 100, includePlanned: true },
      })
      .then((res) => {
        if (alive) setQuests(res.content);
      })
      .catch(() => null);
    return () => {
      alive = false;
    };
  }, [open, props.projectId, questApi]);

  const available = quests.filter((q) => !props.attachedIds.has(q.id));
  const labelOf = (q: QuestResource) => `#${q.shortId} ${q.title}`;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={<Button type="button" variant="outline" size="sm" />}
      >
        <Plus className="size-4" />
        {tr("epic.quests.attach")}
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0" align="start">
        <Command>
          <CommandInput placeholder={tr("epic.quests.attach.search")} />
          <CommandList>
            <CommandEmpty>{tr("common.noResults")}</CommandEmpty>
            <CommandGroup>
              {available.map((q) => (
                <CommandItem
                  key={q.id}
                  value={labelOf(q)}
                  onSelect={() => {
                    props.onAttach(q.id);
                    setOpen(false);
                  }}
                >
                  <span className="text-muted-foreground shrink-0 font-mono text-xs">
                    #{q.shortId}
                  </span>
                  <span className="truncate">{q.title}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
};

export default EpicQuestPicker;
