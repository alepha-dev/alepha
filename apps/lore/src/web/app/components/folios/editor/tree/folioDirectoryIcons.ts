import {
  AppWindow,
  Archive,
  BookOpen,
  Database,
  FileCode2,
  Flag,
  FlaskConical,
  Image,
  Inbox,
  KeyRound,
  Lightbulb,
  Link,
  type LucideIcon,
  Package,
  Palette,
  Pencil,
  Plug,
  Server,
  ShieldCheck,
  SlidersHorizontal,
  StickyNote,
  Trash2,
  TriangleAlert,
  Users,
} from "lucide-react";

/**
 * Directory names that earn a badge in the folio tree, keyed by the
 * NORMALISED name (see {@link resolveDirectoryBadge}).
 *
 * ⚠️ A badge, never a replacement. The folder icon is what makes a row read
 * as a directory at a glance, and swapping it for a `Trash2` costs that at
 * every row for a hint at a handful of them. The badge is additive: the
 * folder still says "directory", the emblem says "which one".
 *
 * ⚠️ Derived from the name, on purpose: `folio_directories` has no `icon`
 * column and this map is the whole feature. The trade that buys is worth
 * stating, because it is invisible from the row itself: renaming `trash` to
 * `bin` silently drops the badge, and a directory that happens to be called
 * `ideas` gets the bulb whether its owner wanted one or not. Cheap and
 * instant for a tree whose top level is already these names; it does not
 * grow into per-project icons without the column.
 *
 * ⚠️ **Every entry has to survive 8px.** That is the size the glyph is
 * drawn at, inside a 10px disc, and it is the constraint that picked
 * several of these over the obvious choice. A gear's teeth close up into a
 * blob, so `settings` is `SlidersHorizontal` and not `Settings`; a bug's
 * legs do the same, so `bugs` is `TriangleAlert` and not `Bug`. Test any
 * addition at that size before trusting it - a glyph with more than about
 * four strokes is usually already lost.
 *
 * ⚠️ `Lock` is deliberately absent. It is what this same tree draws for a
 * protected folio, so a `security` folder wearing one would collide with
 * the one icon in here that already means something specific. Hence
 * `KeyRound`.
 *
 * Singular and plural are separate keys rather than a stemming pass. The
 * extra lines beat a rule that would also fold `archives` onto `archive`
 * and, some day, something nobody meant.
 */
const DIRECTORY_BADGES: Record<string, LucideIcon> = {
  api: Plug,
  app: AppWindow,
  apps: AppWindow,
  archive: Archive,
  asset: Image,
  assets: Image,
  bug: TriangleAlert,
  bugs: TriangleAlert,
  config: SlidersHorizontal,
  data: Database,
  db: Database,
  design: Palette,
  doc: BookOpen,
  docs: BookOpen,
  documentation: BookOpen,
  draft: Pencil,
  drafts: Pencil,
  idea: Lightbulb,
  ideas: Lightbulb,
  inbox: Inbox,
  infra: Server,
  infrastructure: Server,
  issues: TriangleAlert,
  link: Link,
  links: Link,
  media: Image,
  note: StickyNote,
  notes: StickyNote,
  ops: Server,
  people: Users,
  plan: Flag,
  plans: Flag,
  reference: Link,
  references: Link,
  release: Package,
  releases: Package,
  reviews: ShieldCheck,
  roadmap: Flag,
  security: KeyRound,
  settings: SlidersHorizontal,
  spec: FileCode2,
  specs: FileCode2,
  team: Users,
  test: FlaskConical,
  tests: FlaskConical,
  trash: Trash2,
  ui: Palette,
};

/**
 * The badge for a directory row, or `undefined` for the great majority of
 * directories, which wear the plain folder.
 *
 * Matching is on the trimmed, lower-cased name, so `Trash`, `trash` and a
 * name a rename left padded all land on the same entry.
 */
export const resolveDirectoryBadge = (name: string): LucideIcon | undefined =>
  DIRECTORY_BADGES[name.trim().toLowerCase()];
