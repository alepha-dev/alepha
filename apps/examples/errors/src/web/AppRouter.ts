import { AlephaError, createMiddleware, type Middleware } from "alepha";
import { $page } from "alepha/react/router";
import { HttpError } from "alepha/server";
import { createElement } from "react";

import TooManyRequests from "./components/TooManyRequests.tsx";

/**
 * Fails the way a guard, a rate limiter or the not-ready hook fails: around
 * the render, never inside a loader. Those never reach `createLayers`, so they
 * exercise the pre-stream error path rather than the layer one.
 */
const $throwing = (error: Error): Middleware =>
  createMiddleware({
    name: "$throwing",
    handler: () => async () => {
      throw error;
    },
  });

export class AppRouter {
  home = $page({
    path: "/",
    lazy: () => import("./components/Home.tsx"),
  });

  renderError = $page({
    path: "/render-error",
    lazy: () => import("./components/RenderError.tsx"),
  });

  loaderError = $page({
    path: "/loader-error",
    lazy: () => import("./components/LoaderError.tsx"),
    loader: () => {
      throw new AlephaError(
        "Loader crash: this error was thrown in the page loader",
      );
    },
  });

  hookError = $page({
    path: "/hook-error",
    lazy: () => import("./components/HookError.tsx"),
  });

  asyncError = $page({
    path: "/async-error",
    lazy: () => import("./components/AsyncError.tsx"),
  });

  nonErrorThrow = $page({
    path: "/non-error-throw",
    lazy: () => import("./components/NonErrorThrow.tsx"),
  });

  causeChain = $page({
    path: "/cause-chain",
    lazy: () => import("./components/CauseChain.tsx"),
  });

  hydrationMismatch = $page({
    path: "/hydration-mismatch",
    lazy: () => import("./components/HydrationMismatch.tsx"),
  });

  nestedLayout = $page({
    path: "/nested",
    lazy: () => import("./components/NestedLayout.tsx"),
    children: () => [
      this.nestedChildOk,
      this.nestedChildRenderError,
      this.nestedChildLoaderError,
    ],
  });

  nestedChildOk = $page({
    path: "/",
    lazy: () => import("./components/NestedChildOk.tsx"),
  });

  nestedChildRenderError = $page({
    path: "/render-error",
    lazy: () => import("./components/NestedChildRenderError.tsx"),
  });

  nestedChildLoaderError = $page({
    path: "/loader-error",
    lazy: () => import("./components/NestedChildLoaderError.tsx"),
    loader: (): Record<string, never> => {
      throw new AlephaError(
        "Nested child loader crash: thrown in child page loader",
      );
    },
  });

  httpError = $page({
    path: "/http-error",
    lazy: () => import("./components/HttpErrorPage.tsx"),
    loader: () => {
      throw new HttpError({
        status: 404,
        message: "The requested resource does not exist",
      });
    },
  });

  httpError500 = $page({
    path: "/http-error-500",
    lazy: () => import("./components/HttpErrorPage.tsx"),
    loader: () => {
      throw new HttpError({
        status: 500,
        message: "Something broke on the server",
      });
    },
  });

  middlewareError = $page({
    path: "/middleware-error",
    lazy: () => import("./components/MiddlewareError.tsx"),
    use: [
      $throwing(new AlephaError("Middleware crash: thrown before the render")),
    ],
  });

  middlewareNotReady = $page({
    path: "/middleware-503",
    lazy: () => import("./components/MiddlewareError.tsx"),
    use: [
      $throwing(
        new HttpError({
          status: 503,
          message: "Server is not ready yet. Please try again later.",
        }),
      ),
    ],
  });

  /**
   * The same kind of failure, answered by the page's own `errorHandler`.
   */
  middlewareRateLimited = $page({
    path: "/middleware-429",
    lazy: () => import("./components/MiddlewareError.tsx"),
    use: [
      $throwing(new HttpError({ status: 429, message: "Too Many Requests" })),
    ],
    // `createElement` rather than JSX: this file stays `.ts`.
    errorHandler: (error) =>
      HttpError.is(error, 429) ? createElement(TooManyRequests) : undefined,
  });
}
