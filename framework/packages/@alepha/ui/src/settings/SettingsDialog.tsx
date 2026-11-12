import * as React from "react";

void React;

import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { useInject } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { ChevronLeft, ChevronRight, XIcon } from "lucide-react";
import { type ComponentType, lazy, Suspense, useMemo, useState } from "react";

import { Button } from "../core/Button.tsx";
import { useIsMobile } from "../core/useIsMobile.ts";
import { cn } from "../core/utils.ts";
import {
  SettingsDialogs,
  type SettingsSectionPrimitive,
} from "./SettingsDialogs.ts";
import { SettingsDialogSkeleton } from "./SettingsDialogSkeleton.tsx";
import { useSettingsDialog } from "./useSettingsDialog.ts";

export interface SettingsDialogProps {
  /**
   * The dialog to draw, by the name given to `$settingsDialog`.
   */
  name: string;
}

/**
 * One `React.lazy` per section, made once: a new one per render would
 * remount the section, and with it its fetch, on every keystroke.
 */
const lazyComponents = new WeakMap<
  SettingsSectionPrimitive,
  ComponentType<any>
>();
const sectionComponent = (section: SettingsSectionPrimitive) => {
  let component = lazyComponents.get(section);
  if (!component) {
    component = lazy(section.options.lazy);
    lazyComponents.set(section, component);
  }
  return component;
};

/**
 * A settings dialog on screen: a large modal on a desktop, full screen on a
 * phone.
 *
 * - **Desktop:** the nav on the left, the dialog's plain title at its top and
 *   the sections under their group headings; the section on the right, its
 *   lazy component behind a skeleton while it loads. The X, Escape and a
 *   click outside close it. Unsaved edits are not guarded.
 * - **Phone:** the list of sections; tapping one slides into it, and the back
 *   arrow in the dialog returns to the list. State, never history.
 *
 * The nav items are buttons, never anchors: the dialog is state, and nothing
 * in it has a URL. A dialog a section opens (a password change, a delete
 * confirmation) is nested in it, so it stacks over it and closing it leaves
 * the settings dialog open.
 *
 * Drawn by `DialogProvider` for whichever dialog is open, so an application
 * mounts nothing for it.
 */
export const SettingsDialog = (props: SettingsDialogProps) => {
  const settings = useSettingsDialog(props.name);
  const dialogs = useInject(SettingsDialogs);
  const { tr } = useI18n();
  const isMobile = useIsMobile();
  // The phone's two screens. A dialog opened on a named section (a link,
  // `open("sessions")`) lands in it; opened bare, on the list.
  // Reset on each opening, during render rather than in an effect, so the
  // first frame of an opening already shows the right screen.
  const [view, setView] = useState<"list" | "section">("section");
  const [wasOpen, setWasOpen] = useState(false);
  if (settings.isOpen !== wasOpen) {
    setWasOpen(settings.isOpen);
    if (settings.isOpen) {
      setView(dialogs.state().focus ? "section" : "list");
    }
  }

  const dialog = settings.dialog;
  const active = settings.sections.find((it) => it.name === settings.section);
  const title = dialog
    ? dialog.options.titleKey
      ? tr(dialog.options.titleKey, { default: dialog.options.title })
      : dialog.options.title
    : "";
  const label = (section: SettingsSectionPrimitive) =>
    section.options.labelKey
      ? tr(section.options.labelKey, { default: section.options.label })
      : section.options.label;

  const Section = useMemo(
    () => (active ? sectionComponent(active) : undefined),
    [active],
  );

  if (!dialog) {
    return null;
  }

  const close = (
    <DialogPrimitive.Close
      data-slot="settings-dialog-close"
      render={<Button variant="minimal" size="icon-sm" />}
    >
      <XIcon />
      <span className="sr-only">
        {tr("settings.dialog.close", { default: "Close" })}
      </span>
    </DialogPrimitive.Close>
  );

  const showNav = !isMobile || view === "list";
  const showSection = !isMobile || view === "section";

  const nav = (
    <nav
      data-slot="settings-dialog-nav"
      aria-label={title}
      className={cn("flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-3")}
    >
      <div className="flex items-center gap-1">
        <DialogPrimitive.Title
          data-slot="settings-dialog-title"
          className={cn(
            "flex-1 px-2 pt-1 font-semibold",
            isMobile ? "text-lg" : "text-sm",
          )}
        >
          {title}
        </DialogPrimitive.Title>
        {isMobile && close}
      </div>
      {settings.groups.map((group) => (
        <div key={group.group ?? ""} className="flex flex-col gap-0.5">
          {group.group ? (
            <span className="text-muted-foreground px-2 text-[11px] font-semibold tracking-wider uppercase">
              {group.groupKey
                ? tr(group.groupKey, { default: group.group })
                : group.group}
            </span>
          ) : null}
          {group.sections.map((section) => {
            const current = section.name === settings.section;
            return (
              <button
                key={section.name}
                type="button"
                data-slot="settings-dialog-nav-item"
                aria-current={current && !isMobile ? "page" : undefined}
                onClick={() => {
                  settings.open(section.name);
                  setView("section");
                }}
                className={cn(
                  "flex items-center gap-2 rounded-md px-2 text-left whitespace-nowrap [&_svg]:size-4 [&_svg]:shrink-0",
                  isMobile ? "h-11 text-sm" : "h-8 text-sm",
                  current && !isMobile
                    ? "bg-accent text-accent-foreground font-medium"
                    : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
                )}
              >
                {section.options.icon}
                <span className="flex-1 truncate">{label(section)}</span>
                {isMobile && (
                  <ChevronRight className="text-muted-foreground size-4" />
                )}
              </button>
            );
          })}
        </div>
      ))}
    </nav>
  );

  return (
    <DialogPrimitive.Root
      open={settings.isOpen}
      onOpenChange={(open) => {
        if (!open) settings.close();
      }}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Backdrop className="data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0 fixed inset-0 isolate z-50 bg-black/10 duration-100 supports-backdrop-filter:backdrop-blur-xs" />
        <DialogPrimitive.Popup
          data-slot="settings-dialog"
          data-mobile={isMobile || undefined}
          className={cn(
            "bg-popover text-popover-foreground ring-foreground/10 fixed z-50 flex overflow-hidden text-sm ring-1 outline-none",
            isMobile
              ? "inset-0 flex-col"
              : "data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95 top-1/2 left-1/2 h-[min(44rem,calc(100dvh-4rem))] w-[min(64rem,calc(100vw-4rem))] -translate-x-1/2 -translate-y-1/2 rounded-xl duration-100",
          )}
        >
          {showNav && (
            <div
              className={cn(
                "flex min-h-0 flex-col",
                isMobile ? "flex-1" : "bg-muted/40 w-56 shrink-0 border-r",
              )}
            >
              {nav}
            </div>
          )}
          {showSection && (
            <div
              data-slot="settings-dialog-section"
              className={cn(
                "flex min-h-0 min-w-0 flex-1 flex-col",
                isMobile &&
                  "animate-in slide-in-from-right-8 fade-in-0 duration-150",
              )}
            >
              <div
                data-slot="settings-dialog-header"
                className="flex h-12 shrink-0 items-center gap-1 border-b px-2"
              >
                {isMobile && (
                  <Button
                    type="button"
                    variant="minimal"
                    size="icon-sm"
                    data-slot="settings-dialog-back"
                    aria-label={tr("settings.dialog.back", {
                      default: "Back",
                    })}
                    onClick={() => setView("list")}
                  >
                    <ChevronLeft />
                  </Button>
                )}
                <span
                  className={cn(
                    "flex-1 truncate font-medium",
                    !isMobile && "px-2",
                  )}
                >
                  {active ? label(active) : title}
                </span>
                {close}
              </div>
              <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
                {active && Section ? (
                  <Suspense fallback={<SettingsDialogSkeleton />}>
                    <Section
                      key={active.name}
                      {...(active.options.props?.() ?? {})}
                    />
                  </Suspense>
                ) : null}
              </div>
            </div>
          )}
        </DialogPrimitive.Popup>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
};
