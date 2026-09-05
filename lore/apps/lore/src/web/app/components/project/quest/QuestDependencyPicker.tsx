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
import { cn } from "@alepha/ui/lib/utils";
import { useClient } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { Check, ChevronDown, Link2, X } from "lucide-react";
import { useEffect, useState } from "react";

import type { QuestController } from "@/api/controllers/QuestController.ts";
import type { QuestResource } from "@/api/schemas/questResourceSchema.ts";
import type { I18n } from "@/web/app/services/I18n.ts";

import { formatReference } from "../../shared/element/typedReference.ts";

export interface QuestDependencyPickerProps {
  projectId: number;
  /**
   * Selected predecessor quest id, or null when there is no dependency.
   */
  value: number | null;
  onChange: (value: number | null) => void;
  /**
   * When editing, the quest itself is excluded — a quest can't depend on itself.
   */
  excludeQuestId?: number;
}

/**
 * Searchable picker that sets a quest's predecessor (`dependsOn`). The
 * dependency engine (accept-time gating) and the `QuestView` questline display
 * already exist — this is the only surface that lets a user *set* the link from
 * the UI. Value is the predecessor's global quest id (or null).
 */
const QuestDependencyPicker = (props: QuestDependencyPickerProps) => {
  const { tr } = useI18n<I18n, "en">();
  const questApi = useClient<QuestController>();
  const [open, setOpen] = useState(false);
  const [quests, setQuests] = useState<QuestResource[]>([]);

  useEffect(() => {
    let alive = true;
    questApi
      .getQuests({
        params: { projectId: props.projectId },
        // `size` is capped at 100 server-side; for larger projects the
        // combobox search narrows the list (a future enhancement could push
        // the query server-side). `includePlanned: true` so a quest filed
        // under a planned epic is still offered as a predecessor — this is
        // the only surface that sets `dependsOn` from the UI, and it must
        // work inside a planned epic too (design §5.3, direct addressing is
        // never gated). Mirrors `EpicQuestPicker`.
        query: { size: 100, includePlanned: true },
      })
      .then((res) => {
        if (!alive) return;
        setQuests(res.content.filter((q) => q.id !== props.excludeQuestId));
      })
      .catch(() => null);
    return () => {
      alive = false;
    };
  }, [props.projectId, props.excludeQuestId]);

  const selected = quests.find((q) => q.id === props.value);
  const labelOf = (q: QuestResource) =>
    `${formatReference("quest", q.shortId)} - ${q.title}`;

  return (
    <div className="flex items-center gap-2">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          render={
            <Button
              type="button"
              variant="outline"
              className={cn(
                "h-8 w-full min-w-0 justify-between rounded-lg font-normal",
                !selected && "text-muted-foreground",
              )}
            />
          }
        >
          {/* Leading glyph inside the trigger, the way a select trigger
              carries its icon beside the value. It used to sit next to the
              field's label in QuestCreate; every icon in that form lives
              inside its input, so it moved here. */}
          <Link2 className="text-muted-foreground mr-2 size-4 shrink-0" />
          <span className="truncate">
            {selected ? labelOf(selected) : tr("quest.create.dependsOn.none")}
          </span>
          <ChevronDown className="text-muted-foreground ml-auto size-4 shrink-0" />
        </PopoverTrigger>
        <PopoverContent
          // `--anchor-width` is what Base UI's positioner exposes for "as wide
          // as the trigger". The previous `--radix-popover-trigger-width` is
          // defined by nothing here, so the class collapsed to no width at all
          // and the popover sat at `PopoverContent`'s base `w-72` regardless of
          // how wide the trigger was.
          className="w-(--anchor-width) p-0"
          align="start"
        >
          <Command>
            <CommandInput placeholder={tr("quest.create.dependsOn.search")} />
            <CommandList>
              <CommandEmpty>{tr("quest.create.dependsOn.empty")}</CommandEmpty>
              <CommandGroup>
                {quests.map((q) => (
                  <CommandItem
                    key={q.id}
                    value={labelOf(q)}
                    onSelect={() => {
                      props.onChange(q.id === props.value ? null : q.id);
                      setOpen(false);
                    }}
                  >
                    <Check
                      className={cn(
                        "size-4 shrink-0",
                        q.id === props.value ? "opacity-100" : "opacity-0",
                      )}
                    />
                    <span className="truncate">{labelOf(q)}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      {props.value != null && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => props.onChange(null)}
          aria-label={tr("quest.create.dependsOn.clear")}
        >
          <X className="size-4" />
        </Button>
      )}
    </div>
  );
};

export default QuestDependencyPicker;
