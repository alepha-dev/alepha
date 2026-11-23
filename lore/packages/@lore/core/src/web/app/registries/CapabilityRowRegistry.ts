import { AlephaError } from "alepha";
import type { ComponentType } from "react";

/**
 * Rows a module adds to General > Capabilities beside a capability's own
 * options (#Q4184): Plan's Roadmap switch, after Requirements, is a column of
 * the project rather than a capability option, and the page is core's, which
 * may not import Plan.
 *
 * The page renders each option's row, then the rows registered `after` it,
 * nested as options are; a row whose option is not listed comes after the
 * last one. Frozen once read: every shell registers from its
 * constructor, at boot, and a late registration throws.
 */
export class CapabilityRowRegistry {
  protected readonly entries: CapabilityRowEntry[] = [];
  protected frozen = false;

  public register(entry: CapabilityRowEntry): void {
    if (this.frozen) {
      throw new AlephaError(
        `Capability row '${entry.key}' registered after the page was first read`,
      );
    }
    if (this.entries.some((it) => it.key === entry.key)) {
      throw new AlephaError(
        `Capability row '${entry.key}' is registered twice`,
      );
    }
    this.entries.push(entry);
  }

  /**
   * Every row registered for one capability.
   */
  public of(capability: string): CapabilityRowEntry[] {
    this.frozen = true;
    return this.entries.filter((it) => it.capability === capability);
  }

  /**
   * The rows registered after one option of one capability.
   */
  public after(capability: string, option: string): CapabilityRowEntry[] {
    this.frozen = true;
    return this.entries.filter(
      (it) => it.capability === capability && it.after === option,
    );
  }
}

/**
 * What the page hands a registered row.
 */
export interface CapabilityRowProps {
  /**
   * The nesting the option rows carry.
   */
  className?: string;
  /**
   * True while the capability's master switch is off: the row is shown,
   * disabled, as an option is.
   */
  disabled: boolean;
}

export interface CapabilityRowEntry {
  /**
   * Unique across the registry.
   */
  key: string;
  capability: string;
  /**
   * The option the row follows.
   */
  after: string;
  component: ComponentType<CapabilityRowProps>;
}
