import { useEffect, useRef, useState, useSyncExternalStore } from "react";

import { Dialog, DialogContent, DialogTitle } from "../core/Dialog.tsx";
import { Drawer, DrawerContent, DrawerTitle } from "../core/Drawer.tsx";
import { AiChatDock } from "./AiChatDock.tsx";
import { AiChatFloat } from "./AiChatFloat.tsx";
import { AiChatLauncher } from "./AiChatLauncher.tsx";
import { AiChatPanel, type AiChatViewProps } from "./AiChatPanel.tsx";
import { type UseAiChatOptions, useAiChat } from "./useAiChat.ts";
import { useAiChatFloatDrag } from "./useAiChatFloatDrag.ts";

/**
 * Where the conversation sits.
 * - `drawer`: a modal drawer from the right, over a dimmed page.
 * - `dock`: a panel beside the page, which stays readable and usable
 *   (see `AiChatDock`), and folds into a pill.
 * - `auto`: the dock from 1024px up, the drawer below, where a page has no
 *   width to give.
 * - `floating`: a card over the page's bottom corner, the page under it
 *   still usable (see `AiChatFloat`), and folds into a pill.
 */
export type AiChatMode = "auto" | "dock" | "drawer" | "floating";

/**
 * What the conversation is doing, for an app's own button to show while the
 * panel is closed (`onActivityChange`).
 * - `idle`: nothing to say.
 * - `running`: a turn is streaming or running a tool.
 * - `waiting`: a mutation waits for the user's approval.
 * - `unread`: a turn ended while the panel was closed, and nobody opened it
 *   since.
 */
export type AiChatActivity = "idle" | "running" | "waiting" | "unread";

export interface AiChatProps extends UseAiChatOptions, AiChatViewProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * Where the conversation sits. Defaults to `drawer`.
   */
  mode?: AiChatMode;
  /**
   * A docked or floating panel offers a minimize button that folds it into
   * a pill. Default true; an app whose own header has a button for the
   * chat passes false, and closing is then the only way to put it away.
   */
  minimizable?: boolean;
  /**
   * Where a floating card goes when it closes: the app's own button for the
   * chat. Given, the card folds into that element, so the reader sees it
   * put away rather than gone; never under reduced motion, from full
   * screen, or when it returns nothing.
   */
  foldTarget?: () => Element | null | undefined;
  /**
   * Told what the conversation is doing (`AiChatActivity`) each time it
   * changes, open or closed: an app's own button shows it while the panel
   * is closed.
   */
  onActivityChange?: (activity: AiChatActivity) => void;
}

const DOCK_QUERY = "(min-width: 1024px)";

const subscribe = (onChange: () => void) => {
  const mql = window.matchMedia?.(DOCK_QUERY);
  mql?.addEventListener("change", onChange);
  return () => mql?.removeEventListener("change", onChange);
};

/**
 * True where `auto` docks. The server snapshot is false, which is also what
 * the hydration render reads, and the chat is closed on the server anyway.
 */
const useWideScreen = () =>
  useSyncExternalStore(
    subscribe,
    () => window.matchMedia?.(DOCK_QUERY).matches ?? false,
    () => false,
  );

/**
 * The assistant: the conversation of `AiChatPanel`, in a drawer, a dock or a
 * floating card.
 * It knows the page through `useAiContext()`, and runs `navigate` and
 * `fillForm` for the model. The conversation lives here, so it survives a
 * close, a minimize and a switch between drawer and dock: closing hides the
 * panel and never stops a turn, which streams on and is there on reopening.
 *
 * A docked or floating chat minimizes into a pill (`AiChatLauncher`): it reports itself
 * closed through `onOpenChange(false)`, so the app's own button opens it
 * again, and the pill does too. `minimizable={false}` drops both, for an
 * app whose button says what the closed chat is doing (`onActivityChange`).
 *
 * Needs `AlephaApiAi` on the server and a `$ai` declared by the app. A dock
 * needs an `AiChatDockSlot` in the layout to make room for it (`AppShell`'s
 * `aside`); without one it floats over the page's right edge.
 *
 * @example
 * ```tsx
 * const [open, setOpen] = useState(false);
 * <Button onClick={() => setOpen(true)}>Ask</Button>
 * <AiChat
 *   mode="auto"
 *   open={open}
 *   onOpenChange={setOpen}
 *   suggestions={[{ label: "Who still owes today?" }]}
 * />
 * ```
 */
export const AiChat = (props: AiChatProps) => {
  const chat = useAiChat(props);
  const wide = useWideScreen();
  const [minimized, setMinimized] = useState(false);
  const [maximized, setMaximized] = useState(false);
  const [folding, setFolding] = useState(false);
  const [panelKey, setPanelKey] = useState(0);
  const mode = props.mode ?? "drawer";
  const docked = mode === "dock" || (mode === "auto" && wide);
  const floating = mode === "floating" && !docked;

  // Opened or closed, by the panel or by the app's own button: the state
  // that belongs to an open panel follows, in the render that sees it.
  // A floating card closing (not minimizing, not from full screen) folds
  // into `foldTarget` first, still drawn while it does.
  const [wasOpen, setWasOpen] = useState(props.open);
  if (wasOpen !== props.open) {
    setWasOpen(props.open);
    if (props.open) {
      setMinimized(false);
      // Reopened mid-fold: a fresh panel, so it opens as any other does
      // (the composer takes the focus); the conversation lives here.
      if (folding) setPanelKey((key) => key + 1);
      setFolding(false);
    } else {
      setFolding(
        floating && !maximized && !minimized && Boolean(props.foldTarget),
      );
      setMaximized(false);
    }
  }

  // What the conversation is doing, for the app's own button. A turn that
  // ends while the panel is closed leaves it unread until it opens again.
  // A turn, not a stored conversation loading; one that failed has no
  // answer to read.
  const running = chat.answering && !chat.pending;
  const waiting = chat.pending?.kind === "confirm";
  const [unread, setUnread] = useState(false);
  const wasRunning = useRef(running);
  useEffect(() => {
    if (props.open) {
      // oxlint-disable-next-line react/set-state-in-effect -- read on opening
      setUnread(false);
    } else if (wasRunning.current && !running && !chat.error) {
      setUnread(true);
    }
    wasRunning.current = running;
  }, [running, props.open]);
  const activity: AiChatActivity = waiting
    ? "waiting"
    : running
      ? "running"
      : unread
        ? "unread"
        : "idle";
  const onActivityChange = useRef(props.onActivityChange);
  onActivityChange.current = props.onActivityChange;
  useEffect(() => {
    onActivityChange.current?.(activity);
  }, [activity]);
  // Gone, the conversation goes with it: nothing is left to show.
  useEffect(() => () => onActivityChange.current?.("idle"), []);

  // The floating card moves by its header (#Q4562); full screen and the
  // dock stay where they are.
  const drag = useAiChatFloatDrag();

  const close = () => {
    setMinimized(false);
    props.onOpenChange(false);
  };
  const toggleMaximized = () => setMaximized((value) => !value);
  const minimizable = props.minimizable !== false;

  // Full screen, from the dock or the drawer: the panel in a dialog sized as
  // an image lightbox maximizes (a 1rem gap from the screen's edges). Escape
  // or the backdrop restores it, and the conversation stays where it was.
  if (props.open && maximized) {
    return (
      <Dialog open onOpenChange={(open) => open || setMaximized(false)}>
        <DialogContent
          showCloseButton={false}
          data-testid="ai-chat-fullscreen"
          className="flex h-[calc(100dvh-2rem)] max-w-[calc(100vw-2rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-[calc(100vw-2rem)]"
        >
          <AiChatPanel
            {...props}
            chat={chat}
            onClose={close}
            onMaximize={toggleMaximized}
            maximized
            renderTitle={(title, className) => (
              <DialogTitle className={className}>{title}</DialogTitle>
            )}
          />
        </DialogContent>
      </Dialog>
    );
  }

  if (docked || mode === "floating") {
    if (props.open || (floating && folding)) {
      const panel = (
        <AiChatPanel
          key={panelKey}
          {...props}
          chat={chat}
          headerProps={docked ? undefined : drag.headerProps}
          onClose={close}
          onMinimize={
            minimizable
              ? () => {
                  setMinimized(true);
                  props.onOpenChange(false);
                }
              : undefined
          }
          onMaximize={toggleMaximized}
        />
      );
      return docked ? (
        <AiChatDock>{panel}</AiChatDock>
      ) : (
        <AiChatFloat
          style={drag.style}
          title={props.title}
          foldTo={props.open ? undefined : props.foldTarget}
          onFolded={() => setFolding(false)}
        >
          {panel}
        </AiChatFloat>
      );
    }
    return minimized && minimizable ? (
      <AiChatLauncher
        chat={chat}
        title={props.title}
        icon={props.icon}
        onRestore={() => props.onOpenChange(true)}
      />
    ) : null;
  }

  return (
    <Drawer
      open={props.open}
      onOpenChange={(open) => (open ? props.onOpenChange(true) : close())}
      swipeDirection="right"
    >
      <DrawerContent
        // From `sm` up the panel floats: a gap from the page's edges, every
        // corner rounded, a shadow, and no bleed strip past its edge.
        className="flex h-full w-full flex-col gap-0 p-0 sm:h-[calc(100dvh-1.5rem)] sm:max-w-md sm:[--drawer-inset:0.75rem] sm:after:hidden sm:data-[swipe-direction=right]:rounded-2xl sm:data-[swipe-direction=right]:border sm:data-[swipe-direction=right]:shadow-2xl"
      >
        <AiChatPanel
          {...props}
          chat={chat}
          onClose={close}
          onMaximize={toggleMaximized}
          renderTitle={(title, className) => (
            <DrawerTitle className={className}>{title}</DrawerTitle>
          )}
        />
      </DrawerContent>
    </Drawer>
  );
};
