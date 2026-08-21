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

import type { FolioController } from "@/api/controllers/FolioController.ts";
import type { Folio } from "@/api/entities/folios.ts";
import type { I18n } from "@/web/app/services/I18n.ts";

export interface EpicFolioPickerProps {
  projectId: number;
  /** Folio ids already attached to this epic — excluded from the list. */
  attachedIds: Set<string>;
  onAttach: (folioId: string) => void;
}

/**
 * Searchable popover that attaches a project folio to the epic. Lists every
 * project folio (capped at 100, same known limitation as
 * `QuestDependencyPicker`) — attaching moves it here, mirroring
 * `EpicController.attachFolio`, which reassigns `epicId` unconditionally.
 */
const EpicFolioPicker = (props: EpicFolioPickerProps) => {
  const { tr } = useI18n<I18n, "en">();
  const folioApi = useClient<FolioController>();
  const [open, setOpen] = useState(false);
  const [folios, setFolios] = useState<Folio[]>([]);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    folioApi
      .list({ query: { projectId: props.projectId, limit: 100 } })
      .then((res) => {
        if (alive) setFolios(res);
      })
      .catch(() => null);
    return () => {
      alive = false;
    };
  }, [open, props.projectId, folioApi]);

  const available = folios.filter((f) => !props.attachedIds.has(f.id));

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={<Button type="button" variant="outline" size="sm" />}
      >
        <Plus className="size-4" />
        {tr("epic.folios.attach")}
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0" align="start">
        <Command>
          <CommandInput placeholder={tr("epic.folios.attach.search")} />
          <CommandList>
            <CommandEmpty>{tr("common.noResults")}</CommandEmpty>
            <CommandGroup>
              {available.map((folio) => (
                <CommandItem
                  key={folio.id}
                  value={`#${folio.shortId} ${folio.title}`}
                  onSelect={() => {
                    props.onAttach(folio.id);
                    setOpen(false);
                  }}
                >
                  <span className="text-muted-foreground shrink-0 font-mono text-xs">
                    #{folio.shortId}
                  </span>
                  <span className="truncate">{folio.title}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
};

export default EpicFolioPicker;
