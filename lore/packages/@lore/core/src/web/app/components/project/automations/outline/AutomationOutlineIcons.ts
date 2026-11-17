import {
  Bell,
  BookOpen,
  Clock,
  Database,
  Filter,
  ListPlus,
  type LucideIcon,
  Package,
  Tag,
  Zap,
} from "lucide-react";

import type { AutomationGraphNode } from "../../../../../../api/schemas/automationGraphNodeSchema.ts";

/**
 * The icon of each row of the outline (#Q3847): an event, a schedule, what
 * it reads, the condition, and each action by its type.
 */
export class AutomationOutlineIcons {
  public static readonly ACTIONS: Record<string, LucideIcon> = {
    notify: Bell,
    createQuest: ListPlus,
    addTag: Tag,
    appendFolio: BookOpen,
    assignRelease: Package,
  };

  public static of(node: Pick<AutomationGraphNode, "kind" | "type">) {
    if (node.kind === "source") return node.type === "schedule" ? Clock : Zap;
    if (node.kind === "read") return Database;
    if (node.kind === "condition") return Filter;
    return AutomationOutlineIcons.ACTIONS[node.type] ?? Zap;
  }
}
