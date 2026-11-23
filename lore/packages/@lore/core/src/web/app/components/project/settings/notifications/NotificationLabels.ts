import type { I18nProvider } from "alepha/react/i18n";

import type { ProjectEventCatalogEntry } from "../../../../../../api/schemas/projectEventCatalogEntrySchema.ts";

/**
 * How the Notifications page and the bell name events (#Q3892): a translated
 * label per event, falling back to the catalog's English one, the reason an
 * unavailable event is unavailable, and the order resources are listed in.
 */
export class NotificationLabels {
  public static readonly RESOURCES = [
    "quests",
    "epics",
    "releases",
    "feedback",
    "errors",
    "quality",
    "apps",
    "monitors",
    "hosts",
  ];

  public static event(
    tr: I18nProvider<any, any>["tr"],
    entry: Pick<ProjectEventCatalogEntry, "name" | "label">,
  ): string {
    return tr(`notifications.event.${entry.name}`, {
      default: entry.label,
    });
  }

  public static reason(
    tr: I18nProvider<any, any>["tr"],
    entry: Pick<ProjectEventCatalogEntry, "needs">,
  ): string {
    // A Core event needs nothing, so is never unavailable for a capability.
    if (!entry.needs) return "";
    const capability = tr(
      `notifications.capability.${entry.needs.capability}`,
      { default: entry.needs.capability },
    );
    return entry.needs.option
      ? tr("notifications.unavailable.option", {
          args: [entry.needs.option, capability],
        })
      : tr("notifications.unavailable.capability", { args: [capability] });
  }

  public static groups(
    items: ProjectEventCatalogEntry[],
  ): Array<[string, ProjectEventCatalogEntry[]]> {
    const order = NotificationLabels.RESOURCES;
    const resources = [...new Set(items.map((it) => it.resource))].sort(
      (a, b) =>
        (order.indexOf(a) + 1 || order.length + 1) -
        (order.indexOf(b) + 1 || order.length + 1),
    );
    return resources.map((resource) => [
      resource,
      items.filter((it) => it.resource === resource),
    ]);
  }
}
