import {
  Activity,
  Bug,
  CircleDashed,
  Eye,
  Flag,
  Flame,
  Gauge,
  Grid3x3,
  Inbox,
  Layers,
  type LucideIcon,
  TriangleAlert,
  UserCheck,
  Users,
} from "lucide-react";

/**
 * The catalogue names its icon the way the mockup does — a lucide id such as
 * `grid-3x3` — because the metric registry has to stay importable by the
 * server, where a React component means nothing.
 *
 * This is the browser half of that: id to component. A metric whose icon this
 * build does not know renders a dashed circle rather than nothing, so a card
 * added by a newer deploy still has a shape.
 *
 * Explicit rather than dynamic: `lucide-react` exports several hundred icons
 * and a lookup by string would defeat tree-shaking, putting all of them in
 * the bundle for the sake of four.
 */
const ICONS: Record<string, LucideIcon> = {
  activity: Activity,
  bug: Bug,
  eye: Eye,
  flag: Flag,
  flame: Flame,
  gauge: Gauge,
  "grid-3x3": Grid3x3,
  inbox: Inbox,
  layers: Layers,
  "triangle-alert": TriangleAlert,
  "user-check": UserCheck,
  users: Users,
};

export const dashboardMetricIcon = (name: string): LucideIcon =>
  ICONS[name] ?? CircleDashed;
