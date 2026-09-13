import { Button, Popover, PopoverContent, PopoverTrigger } from "@alepha/ui";
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "@alepha/ui/command";
import { useClient } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { Plus } from "lucide-react";
import { useEffect, useState } from "react";

import type { FolioController } from "@/api/controllers/FolioController.ts";
import type { Folio } from "@/api/entities/folios.ts";
import type { I18n } from "@/web/app/services/I18n.ts";

import { formatReference } from "../../shared/element/typedReference.ts";

export interface EpicFolioPickerProps {
  projectId: number;
  /**
   * Folio ids already attached to this epic — excluded from the list.
   */
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
        <Command<Folio>
          items={available}
          itemToStringValue={(folio) =>
            `${formatReference("folio", folio.shortId)} ${folio.title}`
          }
        >
          <CommandInput placeholder={tr("epic.folios.attach.search")} />
          <CommandEmpty>{tr("common.noResults")}</CommandEmpty>
          <CommandList>
            {(folio: Folio) => (
              <CommandItem
                key={folio.id}
                value={folio}
                onClick={() => {
                  props.onAttach(folio.id);
                  setOpen(false);
                }}
              >
                <span className="text-muted-foreground shrink-0 font-mono text-xs">
                  {formatReference("folio", folio.shortId)}
                </span>
                <span className="truncate">{folio.title}</span>
              </CommandItem>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
};

export default EpicFolioPicker;
