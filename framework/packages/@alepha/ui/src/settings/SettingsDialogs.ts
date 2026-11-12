import { $atom, $hook, $inject, Alepha, z } from "alepha";
import { ReactPageProvider, ReactRouter } from "alepha/react/router";
import { currentUserAtom } from "alepha/security";
import { type ComponentType, lazy, type ReactNode } from "react";

import { DialogHosts } from "../core/DialogHosts.ts";

/**
 * A settings dialog, as `$settingsDialog` declares it.
 */
export interface SettingsDialogOptions {
  /**
   * The dialog's id: what `useSettingsDialog(name)` takes, and the query
   * parameter that opens it from a link (`?account=sessions`).
   */
  name: string;
  /**
   * The plain title at the top of the dialog's nav ("Account").
   */
  title: string;
  /**
   * Catalogue key of {@link title}, resolved in the reader's language.
   */
  titleKey?: string;
}

/**
 * A section of a settings dialog, as `$settingsSection` declares it.
 */
export interface SettingsSectionOptions {
  /**
   * The dialog this section belongs to, the value `$settingsDialog` returned.
   */
  dialog: SettingsDialogPrimitive;
  /**
   * The section's id inside its dialog: what `open(section)` takes and the
   * value of the dialog's query parameter (`?account=sessions`).
   */
  name: string;
  /**
   * The nav label, in English; {@link labelKey} names it in the catalogue.
   */
  label: string;
  labelKey?: string;
  /**
   * The nav icon.
   *
   * ⚠️ `createElement(Icon)`, never `<Icon />`, when the declaring class is
   * evaluated in the server graph: `alepha db migrations create` imports it
   * under `tsx` with the classic JSX transform, where the element form emits
   * a bare `React.createElement` and breaks migration generation.
   */
  icon?: ReactNode;
  /**
   * The nav group heading, in English; {@link groupKey} names it in the
   * catalogue. Sections without a group come first, under no heading.
   */
  group?: string;
  groupKey?: string;
  /**
   * Position in the dialog. Sections sort by it inside their group, and
   * groups by their smallest member.
   *
   * @default 0
   */
  order?: number;
  /**
   * Whether the section is offered. A section whose `can` answers `false` is
   * absent from the nav, and opening it (by `open` or by URL) opens the first
   * visible section instead.
   */
  can?: () => boolean;
  /**
   * The section's component, loaded when it is first shown. It fetches its
   * own data (`useQuery`): a section has no loader.
   */
  lazy: () => Promise<{ default: ComponentType<any> }>;
  /**
   * Props given to the component, read each time it renders.
   */
  props?: () => object;
}

/**
 * A declared dialog. Holds its options; the registry is {@link SettingsDialogs}.
 */
export class SettingsDialogPrimitive {
  public readonly options: SettingsDialogOptions;

  constructor(options: SettingsDialogOptions) {
    this.options = options;
  }

  public get name(): string {
    return this.options.name;
  }
}

/**
 * A declared section. Holds its options; the registry is {@link SettingsDialogs}.
 */
export class SettingsSectionPrimitive {
  public readonly options: SettingsSectionOptions;

  constructor(options: SettingsSectionOptions) {
    this.options = options;
  }

  public get name(): string {
    return this.options.name;
  }

  public get dialog(): string {
    return this.options.dialog.name;
  }

  public get order(): number {
    return this.options.order ?? 0;
  }

  public isVisible(): boolean {
    return this.options.can?.() ?? true;
  }
}

/**
 * The visible sections of a dialog, under one nav heading.
 */
export interface SettingsSectionGroup {
  group?: string;
  groupKey?: string;
  sections: SettingsSectionPrimitive[];
}

/**
 * Which settings dialog is open, on which section, and the last section each
 * one showed. In the store and nowhere else: never in the URL, so a reload
 * closes the dialog and forgets where it was.
 */
export const settingsDialogsAtom = $atom({
  name: "alepha.ui.settings.dialogs",
  description: "The open settings dialog and the last section of each.",
  schema: z.object({
    open: z.text().optional(),
    section: z.text().optional(),
    /**
     * Whether the dialog was opened on a named section, so a phone shows that
     * section rather than the list.
     */
    focus: z.boolean().optional(),
    last: z.record(z.text(), z.text()),
  }),
  default: { last: {} },
});

/**
 * The settings dialogs of the application: the registry `$settingsDialog` and
 * `$settingsSection` write into, and the state `useSettingsDialog` reads.
 *
 * It also closes the dialog by itself, which is the part a component cannot
 * do: on any route change (a link, or a `router.push` from inside a section)
 * and when the user signs out. And it opens one from a link made outside the
 * dialog, `?<dialogName>=<section>`, read in the browser only, on load and on
 * every client navigation, then stripped from the URL with a replace.
 */
export class SettingsDialogs {
  protected readonly alepha = $inject(Alepha);
  protected readonly dialogHosts = $inject(DialogHosts);
  protected readonly dialogs = new Map<string, SettingsDialogPrimitive>();
  protected readonly sections: SettingsSectionPrimitive[] = [];

  public registerDialog(dialog: SettingsDialogPrimitive): void {
    this.dialogs.set(dialog.name, dialog);
    // `DialogProvider` draws the host. Lazy, so the dialog's code is fetched
    // the first time one opens rather than with every page.
    this.dialogHosts.register(this.host);
  }

  protected readonly host = lazy(async () => ({
    default: (await import("./SettingsDialogHost.tsx")).SettingsDialogHost,
  }));

  public registerSection(section: SettingsSectionPrimitive): void {
    this.sections.push(section);
  }

  public dialog(name: string): SettingsDialogPrimitive | undefined {
    return this.dialogs.get(name);
  }

  public getDialogs(): SettingsDialogPrimitive[] {
    return [...this.dialogs.values()];
  }

  /**
   * The visible sections of a dialog, by group then order: sections with no
   * group first, then each group ordered by its smallest member.
   */
  public groups(name: string): SettingsSectionGroup[] {
    const visible = this.sections
      .filter((section) => section.dialog === name && section.isVisible())
      .sort((a, b) => a.order - b.order);
    const groups = new Map<string, SettingsSectionGroup>();
    for (const section of visible) {
      const key = section.options.group ?? "";
      let group = groups.get(key);
      if (!group) {
        group = {
          group: section.options.group,
          groupKey: section.options.groupKey,
          sections: [],
        };
        groups.set(key, group);
      }
      group.sections.push(section);
    }
    // `visible` is sorted, so each group's first member is its smallest and
    // insertion order is already "by smallest member". The ungrouped band
    // leads whatever its order.
    return [...groups.values()].sort(
      (a, b) => Number(a.group !== undefined) - Number(b.group !== undefined),
    );
  }

  /**
   * The visible sections of a dialog, in nav order.
   */
  public visibleSections(name: string): SettingsSectionPrimitive[] {
    return this.groups(name).flatMap((group) => group.sections);
  }

  public section(
    name: string,
    section: string,
  ): SettingsSectionPrimitive | undefined {
    return this.visibleSections(name).find((it) => it.name === section);
  }

  /**
   * Open a dialog. Asked for a `section`, on it, or on the first visible
   * section when it is unknown or hidden. Asked for none, on the last section
   * viewed during this visit, or on the first visible one. A dialog with no
   * visible section does not open.
   */
  public open(name: string, section?: string): void {
    const visible = this.visibleSections(name);
    if (visible.length === 0) {
      return;
    }
    const state = this.state();
    const wanted = section ?? state.last[name];
    const target = visible.find((it) => it.name === wanted) ?? visible[0];
    this.alepha.store.set(settingsDialogsAtom, {
      open: name,
      section: target.name,
      focus: section !== undefined,
      last: { ...state.last, [name]: target.name },
    });
  }

  /**
   * Close the open dialog, or only `name` when given and open. The last
   * section is kept, so reopening lands where the reader left.
   */
  public close(name?: string): void {
    const state = this.state();
    if (!state.open || (name && state.open !== name)) {
      return;
    }
    this.alepha.store.set(settingsDialogsAtom, { last: state.last });
  }

  public state() {
    return (
      this.alepha.store.get(settingsDialogsAtom) ?? {
        last: {} as Record<string, string>,
      }
    );
  }

  /**
   * Any route change closes the dialog: a link, a `router.push` out of a
   * section, Back. A navigation that changes nothing (a loader re-run) is not
   * a route change.
   */
  protected readonly onTransitionBegin = $hook({
    on: "react:transition:begin",
    handler: ({ previous, state }) => {
      if (!this.alepha.isBrowser() || !this.state().open) {
        return;
      }
      if (previous && previous.url.href === state.url.href) {
        return;
      }
      this.close();
    },
  });

  /**
   * `?<dialogName>=<section>` opens that dialog on that section, once the
   * navigation that carries it has landed: the first render as well as a
   * client navigation (an inbox row is opened with `router.push`).
   */
  protected readonly onTransitionEnd = $hook({
    on: "react:transition:end",
    handler: ({ state }) => {
      if (!this.alepha.isBrowser()) {
        return;
      }
      this.openFromUrl(state.url);
    },
  });

  /**
   * Signing out closes the dialog: a token-transport sign-out does not
   * reload the page, and nothing in an account dialog means anything to an
   * anonymous visitor.
   */
  protected readonly onUserChange = $hook({
    on: "state:mutated",
    handler: ({ key, value }) => {
      if (key !== currentUserAtom.key || value) {
        return;
      }
      this.close();
    },
  });

  /**
   * Read the dialog parameter of `url`, if any, and act on it: strip it with
   * a replace and open the dialog, or send a signed-out visitor to sign in
   * with a `redirect` that comes back here.
   */
  public openFromUrl(url: URL): void {
    for (const name of this.dialogs.keys()) {
      const section = url.searchParams.get(name);
      if (section === null) {
        continue;
      }
      if (!this.alepha.store.get(currentUserAtom)) {
        this.redirectToLogin(name, section);
        return;
      }
      const router = this.alepha.inject(ReactRouter);
      router.setQueryParams((query) => {
        const { [name]: _, ...rest } = query;
        return rest;
      });
      this.open(name, section);
      return;
    }
  }

  /**
   * Send a signed-out visitor to the sign-in page, returning to
   * `/?<name>=<section>` so the dialog opens after sign-in. Resolved like a
   * guarded page's denial, so `loginRoutesAtom` is honoured. An application
   * with no sign-in page has nowhere to send them, and the link does nothing.
   */
  protected redirectToLogin(name: string, section: string): void {
    const back = new URL(
      `/?${new URLSearchParams({ [name]: section }).toString()}`,
      "http://localhost",
    );
    let redirect: string;
    try {
      redirect = this.alepha
        .inject(ReactPageProvider)
        .denyGuardedPage(back).redirect;
    } catch {
      return;
    }
    void this.alepha.inject(ReactRouter).push(redirect as `/${string}`, {
      replace: true,
    });
  }
}
