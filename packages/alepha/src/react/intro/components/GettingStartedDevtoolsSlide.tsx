import type { GettingStartedSlide } from "./GettingStarted.tsx";

/**
 * Hook that provides the devtools slide content.
 *
 * Always shown: the devtools is not installed into the app, it is a separate
 * tool that finds every app `alepha dev` runs, so there is nothing to detect.
 */
export const useDevtoolsSlide = (): GettingStartedSlide => {
  return {
    text: "Inspect everything.",
    sub: "Every running app, from one place.",
    steps: [
      {
        num: "→",
        text: (
          <>
            Run <code>npx @alepha/devtools</code> in another terminal
          </>
        ),
      },
      {
        num: "✓",
        text: "Browse entities, logs, configuration and dependencies",
      },
    ],
  };
};
