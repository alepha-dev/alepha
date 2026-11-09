import { AlephaError } from "alepha";
import type { ComponentType } from "react";

/**
 * What the app adds to Lore's chrome beyond the modules (#Q3211): a control
 * in the header cluster, and a component mounted once at the root of the
 * layout (a panel that outlives every page, such as an in-app assistant).
 *
 * Core renders both and names neither: `HeaderActions` renders the header
 * entries on every page that has a header, and `Layout` the overlays. The app
 * registers from a service its web module lists, at boot, on both entries,
 * since SSR and hydration read the same registry.
 */
export class ShellExtensionRegistry {
  protected readonly headerEntries: ShellExtension[] = [];
  protected readonly overlayEntries: ShellExtension[] = [];

  public registerHeaderAction(entry: ShellExtension): void {
    this.add(this.headerEntries, entry, "header action");
  }

  public registerOverlay(entry: ShellExtension): void {
    this.add(this.overlayEntries, entry, "overlay");
  }

  /**
   * The header controls, in `order`.
   */
  public headerActions(): ShellExtension[] {
    return this.headerEntries;
  }

  /**
   * The components mounted once at the layout's root.
   */
  public overlays(): ShellExtension[] {
    return this.overlayEntries;
  }

  protected add(
    list: ShellExtension[],
    entry: ShellExtension,
    kind: string,
  ): void {
    if (list.some((it) => it.key === entry.key)) {
      throw new AlephaError(`Shell ${kind} '${entry.key}' is registered twice`);
    }
    list.push(entry);
    list.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  }
}

/**
 * One addition to the chrome.
 */
export interface ShellExtension {
  key: string;
  component: ComponentType;
  /**
   * Position among its kind, lowest first. Defaults to 0.
   */
  order?: number;
}
