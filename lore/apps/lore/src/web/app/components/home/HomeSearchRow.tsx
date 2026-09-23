import { CommandItem, CommandShortcut } from "@alepha/ui/command";
import {
  ArrowRight,
  FileText,
  Flag,
  Folder,
  Inbox,
  Layers,
  Lock,
  type LucideIcon,
  Swords,
} from "lucide-react";

import type { ProjectOverviewResource } from "@/api/schemas/projectResourceSchema.ts";

import { formatReference } from "../shared/element/typedReference.ts";
import { ProjectIcon } from "../shared/ProjectIcon.tsx";
import type { HomeSearchHit } from "./useHomeSearch.ts";

/**
 * One row of Home's search dropdown: a project to open, or a hit inside one.
 */
export type HomeSearchRowItem =
  | {
      key: string;
      kind: "project";
      project: ProjectOverviewResource;
      href: string;
    }
  | {
      key: string;
      kind: "hit";
      hit: HomeSearchHit;
      project: ProjectOverviewResource;
      href: string;
    };

export interface HomeSearchRowProps {
  item: HomeSearchRowItem;
  onSelect: (item: HomeSearchRowItem) => void;
}

/**
 * A dropdown row: the glyph, the title, a muted line of context, and the
 * reference on the right. The arrow appears on the highlighted row only, so
 * the eye sees which one Enter opens. The glyphs are the palette's, which
 * are the sidebar entries' own, so a row reads as the page it opens.
 *
 * On a phone the line of context is dropped: beside the title it left room
 * for a word of each.
 */
export const HomeSearchRow = (props: HomeSearchRowProps) => {
  const item = props.item;
  const HitIcon = item.kind === "hit" ? hitIcon(item.hit) : FileText;

  return (
    <CommandItem
      value={item}
      onClick={() => props.onSelect(item)}
      className="gap-3 rounded-lg px-3 py-2"
    >
      {item.kind === "project" ? (
        <ProjectIcon
          fileId={item.project.icon}
          className="size-5 rounded-sm"
          alt=""
        />
      ) : (
        <HitIcon className="text-muted-foreground" aria-hidden />
      )}
      <span className="flex min-w-0 flex-1 items-baseline gap-2">
        <span className="shrink truncate sm:max-w-[70%] sm:shrink-0">
          {item.kind === "project" ? item.project.title : item.hit.title}
        </span>
        {item.kind === "hit" && item.hit.description && (
          <span className="text-muted-foreground min-w-0 flex-1 truncate text-xs max-sm:hidden">
            {item.hit.description}
          </span>
        )}
      </span>
      <CommandShortcut className="flex items-center gap-2 tracking-normal tabular-nums">
        {item.kind === "hit" &&
          item.hit.kind !== "directory" &&
          formatReference(item.hit.kind, item.hit.shortId)}
        <ArrowRight className="size-4 opacity-0 group-data-highlighted/command-item:opacity-100" />
      </CommandShortcut>
    </CommandItem>
  );
};

/**
 * The glyph of a hit's kind.
 */
const hitIcon = (hit: HomeSearchHit): LucideIcon => {
  if (hit.kind === "quest") return Swords;
  if (hit.kind === "epic") return Layers;
  if (hit.kind === "release") return Flag;
  if (hit.kind === "feedback") return Inbox;
  if (hit.kind === "directory") return Folder;
  return hit.protected ? Lock : FileText;
};
