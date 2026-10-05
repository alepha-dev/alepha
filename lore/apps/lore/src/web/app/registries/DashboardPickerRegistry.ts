import { AlephaError } from "alepha";

import type { DashboardScope } from "../../../api/schemas/dashboardScopeSchema.ts";
import type { DashboardScopeApp } from "../components/dashboard/DashboardScopeStep.tsx";

/**
 * What a dashboard card's scope and filter steps can offer, from the modules
 * that own it (#E75, #Q2624): Deploy's apps, Work's quest tags, epics and
 * releases. The project dashboard reads none of their clients or atoms.
 *
 * ## ⚠️ The sources are frozen once read
 *
 * Every source is a HOOK the dashboard calls on each render, in a loop over
 * the registered subjects, which is only legal while the loop is the same
 * length on every render. The set closes the first time it is read: every
 * shell registers from its constructor, at boot, and a late registration
 * throws.
 */
export class DashboardPickerRegistry {
  protected apps?: DashboardAppSource;
  protected tags?: DashboardTagSource;
  protected readonly subjects: DashboardSubjectPicker[] = [];
  protected frozen = false;

  public registerApps(source: DashboardAppSource): void {
    this.assertOpen("apps");
    this.apps = source;
  }

  public registerTags(source: DashboardTagSource): void {
    this.assertOpen("tags");
    this.tags = source;
  }

  public registerSubject(picker: DashboardSubjectPicker): void {
    this.assertOpen(picker.kind);
    if (this.subjects.some((it) => it.kind === picker.kind)) {
      throw new AlephaError(
        `Dashboard scope picker '${picker.kind}' is registered twice`,
      );
    }
    this.subjects.push(picker);
    this.subjects.sort((a, b) => a.order - b.order);
  }

  public sources(): {
    apps?: DashboardAppSource;
    tags?: DashboardTagSource;
    subjects: readonly DashboardSubjectPicker[];
  } {
    this.frozen = true;
    return { apps: this.apps, tags: this.tags, subjects: this.subjects };
  }

  protected assertOpen(key: string): void {
    if (this.frozen) {
      throw new AlephaError(
        `Dashboard picker '${key}' registered after the pickers were first read`,
      );
    }
  }
}

/**
 * What every source is asked for: the board's project, and whether the
 * catalogue is open. A board with no app-scoped or tag-filtered card never
 * needs a picker, so a source fetches nothing while it is closed.
 */
export interface DashboardPickerContext {
  projectId?: number;
  projectTitle: string;
  open: boolean;
}

export interface DashboardAppSource {
  /**
   * A HOOK. A failure costs the picker its options, never the page.
   */
  useApps: (context: DashboardPickerContext) => DashboardScopeApp[];
}

export interface DashboardTagSource {
  /**
   * A HOOK: the board project's own quest tags, for a metric whose filter
   * is one.
   */
  useTags: (context: DashboardPickerContext) => string[];
}

/**
 * One scope kind that names a single row of a module: an epic, a release.
 */
export interface DashboardSubjectPicker {
  kind: DashboardScope["kind"];
  order: number;
  /**
   * A HOOK: the rows offered, already labelled.
   */
  useOptions: (context: DashboardPickerContext) => DashboardScopeOption[];
  /**
   * The i18n key the step shows when the project holds none.
   */
  emptyKey: string;
  toScope: (id: number) => DashboardScope;
  /**
   * The row a scope names, when it is of this kind.
   */
  selectedId: (scope: DashboardScope) => number | undefined;
}

export interface DashboardScopeOption {
  id: number;
  /**
   * Before the label, in the muted tabular style: an epic's `#2`.
   */
  prefix?: string;
  label: string;
  /**
   * The line under the label: an epic's status, a release's state.
   */
  detail: string;
}

/**
 * One registered subject picker with its options for the open board.
 */
export interface DashboardSubjectOptions {
  picker: DashboardSubjectPicker;
  options: DashboardScopeOption[];
}
