import {
  AppWindow,
  BookOpen,
  Bug,
  Circle,
  Flag,
  FolderKanban,
  Grid3x2,
  Inbox,
  KeyRound,
  Layers,
  type LucideIcon,
  Package,
  Server,
  Tag,
  User,
} from "lucide-react";

/**
 * A resource kind's icon, for the activity page's Resource filter.
 *
 * The kinds that have a sidebar entry take that entry's icon (`capabilityNav`),
 * so the filter and the sidebar name a kind with the same glyph. The rest take
 * the icon the admin area gives them (`Server` for an estate), or one of their
 * own.
 *
 * `Circle` for a kind with no entry here, for the reason
 * `activityResourceLabel` falls back to the raw value: a new `$audit` type
 * reaches the page the moment it is declared, and a row with an icon beside
 * rows without one reads as a mistake.
 */
export const activityResourceIcon = (type: string): LucideIcon =>
  ACTIVITY_RESOURCE_ICONS[type] ?? Circle;

const ACTIVITY_RESOURCE_ICONS: Record<string, LucideIcon> = {
  quest: Grid3x2,
  epic: Layers,
  release: Flag,
  folio: BookOpen,
  feedback: Inbox,
  member: User,
  app: AppWindow,
  sigil: KeyRound,
  estate: Server,
  project: FolderKanban,
  blight: Bug,
  artifact: Package,
  area: Tag,
};
