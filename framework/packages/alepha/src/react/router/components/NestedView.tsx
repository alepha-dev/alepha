import { ErrorBoundary, useAlepha, useEvents, useInject } from "alepha/react";
import {
  addTransitionType,
  memo,
  type ReactNode,
  startTransition,
  use,
  useLayoutEffect,
  useRef,
  useState,
  ViewTransition,
} from "react";

import { RouterLayerContext } from "../contexts/RouterLayerContext.ts";
import { Redirection } from "../errors/Redirection.ts";
import { useRouterState } from "../hooks/useRouterState.ts";
import type { ReactRouterState } from "../providers/ReactPageProvider.ts";
import { ReactViewTransition } from "../services/ReactViewTransition.ts";
import ErrorViewer from "./ErrorViewer.tsx";

export interface NestedViewProps {
  children?: ReactNode;
  errorBoundary?: false | ((error: Error, reset: () => void) => ReactNode);
}

/**
 * A component that renders the current view of the nested router layer.
 *
 * To be simple, it renders the `element` of the current child page of a parent page.
 *
 * @example
 * ```tsx
 * import { NestedView } from "alepha/react";
 *
 * class App {
 *   parent = $page({
 *     component: () => <NestedView />,
 *   });
 *
 *   child = $page({
 *     parent: this.root,
 *     component: () => <div>Child Page</div>,
 *   });
 * }
 * ```
 */
const NestedView = (props: NestedViewProps) => {
  const routerLayer = use(RouterLayerContext);
  const index = routerLayer?.index ?? 0;
  const onError = routerLayer?.onError;
  const state = useRouterState();
  const alepha = useAlepha();
  const viewTransition = useInject(ReactViewTransition);

  // Navigating away from a page that threw must clear the boundary — otherwise
  // the fallback latches and every later page keeps rendering the old error
  // until a full reload. Resetting on the path (rather than remounting via
  // `key`) recovers without tearing down the children on every navigation.
  const boundaryResetKeys = [state.url.pathname];

  const [view, setView] = useState<NestedViewSlot>({
    element: state.layers[index]?.element,
    slot: 0,
  });

  // Only the root view reports the commit: it is always mounted, and a
  // navigation that reuses every layer changes no view at all.
  const [committed, setCommitted] = useState<ReactRouterState>();

  const route = useRef(state.layers[index]?.route);

  // The class of the view that is leaving. React reads it at the commit, from
  // the props that view last rendered with, so a page whose exit depends on
  // the target can only answer through an object read that late.
  const exitClass = useRef({ default: "none" });

  // A new slot is what makes a navigation an exit and an enter rather than an
  // update. It only moves when a page asked for one: React starts a view
  // transition, a snapshot of the whole document, for every `<ViewTransition>`
  // it places, whatever its class.
  const slot = useRef(0);

  // ⚠️ Stays synchronous. All the views of a navigation must land in one
  // commit, and so one view transition: `startTransition` calls share a commit
  // when they run in the same tick, which an `await` here would break.
  useEvents(
    {
      "react:transition:end": ({ state }) => {
        const layer = state.layers[index];
        const classes = viewTransition.resolve(
          layer?.route?.viewTransition,
          state,
        );

        if (!layer?.cache) {
          const exit = viewTransition.resolve(
            route.current?.viewTransition,
            state,
          ).exit;
          exitClass.current.default = exit ?? "none";
          route.current = layer?.route;
          if (exit || classes.enter) {
            slot.current += 1;
          }
        }

        startTransition(() => {
          if (state.name) {
            addTransitionType(state.name);
          }
          if (!routerLayer) {
            setCommitted(state);
          }
          if (!layer?.cache) {
            setView({
              element: layer?.element,
              slot: slot.current,
              enter: classes.enter,
              update: classes.update,
            });
          }
        });
      },
    },
    [],
  );

  useLayoutEffect(() => {
    if (committed) {
      void alepha.events.emit("react:transition:committed", {
        state: committed,
      });
    }
  }, [committed]);

  // `default="none"`: a page that asks for nothing gets no view transition
  // name at all, so it never animates.
  const element = (
    <ViewTransition
      key={view.slot}
      default="none"
      enter={view.enter}
      exit={exitClass.current}
      update={view.update}
    >
      {view.element ?? props.children ?? null}
    </ViewTransition>
  );

  if (props.errorBoundary === false) {
    return <>{element}</>;
  }

  if (props.errorBoundary) {
    return (
      <ErrorBoundary
        fallback={props.errorBoundary}
        resetKeys={boundaryResetKeys}
      >
        {element}
      </ErrorBoundary>
    );
  }

  const fallback = (error: Error) => {
    const result = onError?.(error, state) ?? (
      <ErrorViewer error={error} alepha={alepha} />
    );
    if (result instanceof Redirection) {
      return "Redirection inside ErrorBoundary is not allowed.";
    }
    return result as ReactNode;
  };

  return (
    <ErrorBoundary fallback={fallback} resetKeys={boundaryResetKeys}>
      {element}
    </ErrorBoundary>
  );
};

export default memo(NestedView);

interface NestedViewSlot {
  element: ReactNode;
  slot: number;
  enter?: string;
  update?: string;
}
