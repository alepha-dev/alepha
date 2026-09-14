import { Button, Popover, PopoverContent, PopoverTrigger } from "@alepha/ui";
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "@alepha/ui/command";
import { useClient, useQuery } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { Plus } from "lucide-react";
import { useState } from "react";

import type { QuestController } from "@/api/controllers/QuestController.ts";
import type { QuestResource } from "@/api/schemas/questResourceSchema.ts";
import type { I18n } from "@/web/app/services/I18n.ts";

import { formatReference } from "../../shared/element/typedReference.ts";

export interface EpicQuestPickerProps {
  projectId: number;
  /**
   * Quest ids already attached to this epic — excluded from the list.
   */
  attachedIds: Set<number>;
  /**
   * True while a membership write on the page runs (#E59 rule 10).
   */
  disabled: boolean;
  onAttach: (questId: number) => void;
}

/**
 * Searchable popover that attaches a project quest to the epic. Lists every
 * project quest, `includeDrafts: true` so a quest filed under a different
 * (possibly draft) epic still shows up — attaching moves it here, mirroring
 * `EpicController.attachQuest`, which reassigns `epicId` unconditionally
 * rather than refusing an already-attached quest.
 */
const EpicQuestPicker = (props: EpicQuestPickerProps) => {
  const { tr } = useI18n<I18n, "en">();
  const questApi = useClient<QuestController>();
  const [open, setOpen] = useState(false);

  // Read each time the popover opens, and quiet on failure (#E59, #Q2326): a
  // picker with no suggestions is still a picker, and `onError` keeps the
  // failure out of the toaster and in error reporting.
  const quests =
    useQuery(
      {
        key: ["quests", props.projectId, { includeDrafts: true }],
        enabled: open,
        handler: async () =>
          (
            await questApi.getQuests({
              params: { projectId: props.projectId },
              // `size` is capped at 100 server-side; for larger projects the
              // combobox search narrows the list (same known limitation as
              // `QuestDependencyPicker`).
              query: { size: 100, includeDrafts: true },
            })
          ).content,
        onError: () => {},
      },
      [questApi, props.projectId],
    ).data ?? [];

  const available = quests.filter((q) => !props.attachedIds.has(q.id));
  const labelOf = (q: QuestResource) =>
    `${formatReference("quest", q.shortId)} ${q.title}`;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={props.disabled}
          />
        }
      >
        <Plus className="size-4" />
        {tr("epic.quests.attach")}
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0" align="start">
        <Command<QuestResource> items={available} itemToStringValue={labelOf}>
          <CommandInput placeholder={tr("epic.quests.attach.search")} />
          <CommandEmpty>{tr("common.noResults")}</CommandEmpty>
          <CommandList>
            {(q: QuestResource) => (
              <CommandItem
                key={q.id}
                value={q}
                onClick={() => {
                  props.onAttach(q.id);
                  setOpen(false);
                }}
              >
                <span className="text-muted-foreground shrink-0 font-mono text-xs">
                  {formatReference("quest", q.shortId)}
                </span>
                <span className="truncate">{q.title}</span>
              </CommandItem>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
};

export default EpicQuestPicker;
