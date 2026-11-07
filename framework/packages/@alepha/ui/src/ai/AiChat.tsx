import { useEffect, useState, useSyncExternalStore } from "react";

import { Drawer, DrawerContent, DrawerTitle } from "../core/Drawer.tsx";
import { AiChatDock } from "./AiChatDock.tsx";
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
 */
export type AiChatMode = "auto" | "dock" | "drawer";

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
 * The assistant: the conversation of `AiChatPanel`, in a drawer or a dock.
 * It knows the page through `useAiContext()`, and runs `navigate` and
 * `fillForm` for the model. The conversation lives here, so it survives a
 * close, a minimize and a switch between drawer and dock.
 *
 * A docked chat minimizes into a pill (`AiChatLauncher`): it reports itself
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

  const close = () => {
    setMinimized(false);
    props.onOpenChange(false);
  };

  if (docked) {
    if (props.open) {
      return (
        <AiChatDock>
          <AiChatPanel
            {...props}
            chat={chat}
            onClose={close}
            onMinimize={() => {
              setMinimized(true);
              props.onOpenChange(false);
            }}
          />
        </AiChatDock>
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
          renderTitle={(title, className) => (
            <DrawerTitle className={className}>{title}</DrawerTitle>
          )}
        />
      </DrawerContent>
    </Drawer>
  );
};
