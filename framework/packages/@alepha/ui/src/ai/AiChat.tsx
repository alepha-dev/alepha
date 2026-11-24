import { useEffect, useState, useSyncExternalStore } from "react";

import { Dialog, DialogContent, DialogTitle } from "../core/Dialog.tsx";
import { Drawer, DrawerContent, DrawerTitle } from "../core/Drawer.tsx";
import { AiChatDock } from "./AiChatDock.tsx";
import { AiChatFloat } from "./AiChatFloat.tsx";
import { AiChatLauncher } from "./AiChatLauncher.tsx";
import { AiChatPanel, type AiChatViewProps } from "./AiChatPanel.tsx";
import { type UseAiChatOptions, useAiChat } from "./useAiChat.ts";

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

export interface AiChatProps extends UseAiChatOptions, AiChatViewProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * Where the conversation sits. Defaults to `drawer`.
   */
  mode?: AiChatMode;
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
 * close, a minimize and a switch between drawer and dock.
 *
 * A docked or floating chat minimizes into a pill (`AiChatLauncher`): it reports itself
 * closed through `onOpenChange(false)`, so the app's own button opens it
 * again, and the pill does too.
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
  const mode = props.mode ?? "drawer";
  const docked = mode === "dock" || (mode === "auto" && wide);

  // Opened again, from the pill or from the app's own button: the pill goes.
  useEffect(() => {
    if (props.open) {
      // oxlint-disable-next-line react/set-state-in-effect -- `open` is the app's state; the pill follows it
      setMinimized(false);
    }
  }, [props.open]);

  const [maximized, setMaximized] = useState(false);

  const close = () => {
    setMinimized(false);
    setMaximized(false);
    props.onOpenChange(false);
  };
  const toggleMaximized = () => setMaximized((value) => !value);

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
    const Container = docked ? AiChatDock : AiChatFloat;
    if (props.open) {
      return (
        <Container>
          <AiChatPanel
            {...props}
            chat={chat}
            onClose={close}
            onMinimize={() => {
              setMinimized(true);
              props.onOpenChange(false);
            }}
            onMaximize={toggleMaximized}
          />
        </Container>
      );
    }
    return minimized ? (
      <AiChatLauncher
        chat={chat}
        title={props.title}
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
