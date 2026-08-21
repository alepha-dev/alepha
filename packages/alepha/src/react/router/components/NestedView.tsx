import { DateTimeProvider } from "alepha/datetime";
import { ErrorBoundary, useAlepha, useEvents, useInject } from "alepha/react";
import { memo, type ReactNode, use, useRef, useState } from "react";

import { RouterLayerContext } from "../contexts/RouterLayerContext.ts";
import { Redirection } from "../errors/Redirection.ts";
import { useRouterState } from "../hooks/useRouterState.ts";
import type { PageAnimation } from "../primitives/$page.ts";
import type { ReactRouterState } from "../providers/ReactPageProvider.ts";
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
  const dateTime = useInject(DateTimeProvider);

  // Navigating away from a page that threw must clear the boundary — otherwise
  // the fallback latches and every later page keeps rendering the old error
  // until a full reload. Resetting on the path (rather than remounting via
  // `key`) recovers without tearing down the children on every navigation.
  const boundaryResetKeys = [state.url.pathname];

  const [view, setView] = useState<ReactNode | undefined>(
    state.layers[index]?.element,
  );

  const [animation, setAnimation] = useState("");
  const animationExitDuration = useRef<number>(0);
  const animationExitNow = useRef<number>(0);

  // Every `react:transition:end` claims the next number. A handler that has to
  // sleep out an exit animation re-checks it on waking: if a later transition
  // claimed one meanwhile, that transition has already committed its view and
  // this one is showing a page the user navigated away from.
  const commitGeneration = useRef<number>(0);

  useEvents(
    {
      "react:transition:begin": async ({ previous, state }) => {
        // --------- Animations Begin ---------
        const layer = previous.layers[index];
        if (!layer) {
          return;
        }

        if (`${state.url.pathname}/`.startsWith(`${layer.path}/`)) {
          return;
        }

        const animationExit = parseAnimation(
          layer.route?.animation,
          state,
          "exit",
        );

        if (animationExit) {
          const duration = animationExit.duration || 200;
          animationExitNow.current = dateTime.nowMillis();
          animationExitDuration.current = duration;
          setAnimation(animationExit.animation);
        } else {
          animationExitNow.current = 0;
          animationExitDuration.current = 0;
          setAnimation("");
        }
        // --------- Animations End ---------
      },
      "react:transition:end": async ({ state }) => {
        const layer = state.layers[index];
        const generation = ++commitGeneration.current;

        // --------- Animations Begin ---------
        if (animationExitNow.current) {
          const duration = animationExitDuration.current;
          const diff = dateTime.nowMillis() - animationExitNow.current;
          if (diff < duration) {
            await new Promise((resolve) =>
              dateTime.createTimeout(resolve as () => void, duration - diff),
            );
          }
        }

        if (generation !== commitGeneration.current) {
          // Superseded while we slept — the newer transition owns the view
          // and its animation state. Committing here would put the old page
          // back on screen.
          return;
        }
        // --------- Animations End ---------

        if (!layer?.cache) {
          setView(layer?.element);

          // --------- Animations Begin ---------
          const animationEnter = parseAnimation(
            layer?.route?.animation,
            state,
            "enter",
          );

          if (animationEnter) {
            setAnimation(animationEnter.animation);
          } else {
            setAnimation("");
          }
          // --------- Animations End ---------
        }
      },
    },
    [],
  );

  let element = view ?? props.children ?? null;

  // --------- Animations Begin ---------
  if (animation) {
    element = (
      <div
        style={{
          display: "flex",
          flex: 1,
          height: "100%",
          width: "100%",
          position: "relative",
          overflow: "hidden",
        }}
      >
        <div
          style={{ height: "100%", width: "100%", display: "flex", animation }}
        >
          {element}
        </div>
      </div>
    );
  }
  // --------- Animations End ---------

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

function parseAnimation(
  animationLike: PageAnimation | undefined,
  state: ReactRouterState,
  type: "enter" | "exit" = "enter",
):
  | {
      duration: number;
      animation: string;
    }
  | undefined {
  if (!animationLike) {
    return undefined;
  }

  const DEFAULT_DURATION = 300;

  const animation =
    typeof animationLike === "function" ? animationLike(state) : animationLike;

  if (typeof animation === "string") {
    if (type === "exit") {
      return;
    }
    return {
      duration: DEFAULT_DURATION,
      animation: `${DEFAULT_DURATION}ms ${animation}`,
    };
  }

  if (typeof animation === "object") {
    const anim = animation[type];
    const duration =
      typeof anim === "object"
        ? (anim.duration ?? DEFAULT_DURATION)
        : DEFAULT_DURATION;
    const name = typeof anim === "object" ? anim.name : anim;

    if (type === "exit") {
      const timing = typeof anim === "object" ? (anim.timing ?? "") : "";
      return {
        duration,
        animation: `${duration}ms ${timing} ${name}`,
      };
    }

    const timing = typeof anim === "object" ? (anim.timing ?? "") : "";

    return {
      duration,
      animation: `${duration}ms ${timing} ${name}`,
    };
  }

  return undefined;
}
