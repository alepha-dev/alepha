import { AlephaError } from "alepha";
import type { ReactNode } from "react";

import type { CapabilityKey } from "../../../api/schemas/capabilityKeySchema.ts";

/**
 * Rows a module adds to the spotlight (#E175): a group of rows that act
 * rather than navigate, such as a prompt to copy or run, with the dialog
 * they open. `@lore/prompts` registers its rows here; core's spotlight
 * names no module.
 *
 * Each source is a hook, called by the spotlight on every render in
 * registration order: frozen at first read, so the order of the
 * spotlight's hooks never changes.
 */
export class SpotlightSourceRegistry {
  protected readonly entries: SpotlightSource[] = [];
  protected frozen = false;

  public register(source: SpotlightSource): void {
    if (this.frozen) {
      throw new AlephaError(
        `Spotlight source '${source.key}' registered after the spotlight was first read`,
      );
    }
    if (this.entries.some((it) => it.key === source.key)) {
      throw new AlephaError(
        `Spotlight source '${source.key}' is registered twice`,
      );
    }
    this.entries.push(source);
  }

  /**
   * The sources, in registration order.
   */
  public all(): readonly SpotlightSource[] {
    this.frozen = true;
    return this.entries;
  }
}

export interface SpotlightSource {
  key: string;
  /**
   * The capability the source belongs to. While the project has it off,
   * the source reads nothing and offers no row.
   */
  capability?: CapabilityKey;
  /**
   * A hook: what the source offers for the palette's query. `wanted` turns
   * true once the palette has opened in a project, and stays true, so a
   * source reads nothing on a page load.
   */
  useGroup: (context: SpotlightSourceContext) => SpotlightSourceGroup;
}

export interface SpotlightSourceContext {
  query: string;
  wanted: boolean;
}

export interface SpotlightSourceGroup {
  heading: string;
  rows: SpotlightActionRow[];
  /**
   * Rendered beside the palette, for the dialogs the rows open.
   */
  dialog?: ReactNode;
}

export interface SpotlightActionRow {
  key: string;
  label: string;
  icon: ReactNode;
  /**
   * Called once the palette has closed, so a dialog it opens is on top.
   */
  onSelect: () => void;
}
