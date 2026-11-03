import { DateTimeProvider } from "alepha/datetime";
import { ErrorBoundary, useAlepha, useEvents, useInject } from "alepha/react";
import {
  addTransitionType,
  type ComponentType,
  memo,
  type ReactNode,
  startTransition,
  Suspense,
  use,
  useEffect,
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
import OverlayView from "./OverlayView.tsx";

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
  const dateTime = useInject(DateTimeProvider);

  // Navigating away from a page that threw must clear the boundary — otherwise
  // the fallback latches and every later page keeps rendering the old error
  // until a full reload. Resetting on the path (rather than remounting via
  // `key`) recovers without tearing down the children on every navigation.
  const boundaryResetKeys = [state.url.pathname];

  const [view, setView] = useState<NestedViewSlot>({
    element: state.layers[index]?.element,
    slot: 0,
    loading: state.layers[index]?.route?.loading,
  });

  // The component in the slot while its navigation runs. In a ref as well, for
  // the handlers below, which close over the first render.
  const [skeleton, setSkeleton] = useState<ComponentType>();
  const skeletonShown = useRef(false);
  const skeletonTimer = useRef<{ clear: () => void }>(undefined);

  useEffect(() => () => skeletonTimer.current?.clear(), []);

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
      "react:layer:requested": ({ index: requested, loading, delay }) => {
        skeletonTimer.current?.clear();

        const show = () => {
          skeletonShown.current = true;
          setSkeleton(() => loading);
        };

        if (requested !== index || !loading) {
          skeletonShown.current = false;
          setSkeleton(undefined);
        } else if (skeletonShown.current) {
          // A navigation superseding another: the slot is already waiting.
          show();
        } else {
          skeletonTimer.current = dateTime.createTimeout(show, delay);
        }
      },
      "react:transition:end": ({ state }) => {
        const layer = state.layers[index];

        // Every exit lands here: a page, an error, a redirect's follow-up, and
        // a return to the page on screen, which reuses its layer and so sets
        // no view. Undoing the skeleton is not tied to a view changing.
        skeletonTimer.current?.clear();
        skeletonShown.current = false;

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
          setSkeleton(undefined);
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
              loading: layer?.route?.loading,
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

  const Skeleton = skeleton;
  const Loading = view.loading;

  let content = view.element ?? props.children ?? null;
  if (Skeleton) {
    content = <Skeleton />;
  } else if (Loading) {
    content = <Suspense fallback={<Loading />}>{content}</Suspense>;
  }

  // `default="none"`: a page that asks for nothing gets no view transition
  // name at all, so it never animates.
  const element = (
    <>
      <ViewTransition
        key={view.slot}
        default="none"
        enter={view.enter}
        exit={exitClass.current}
        update={view.update}
      >
        {content}
      </ViewTransition>
      <OverlayView index={index} />
    </>
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
    // The state's handler first: it is the page's own, then its parents', where
    // `onError` is the layer above this slot's, and nothing at all at the root.
    const result = state.onError?.(error, state) ?? onError?.(error, state) ?? (
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
  loading?: ComponentType;
}
