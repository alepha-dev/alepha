import type { GettingStartedSlide } from "./GettingStarted.tsx";

/**
 * Hook that provides the devtools slide content.
 * Only shown when @alepha/devtools is installed and enabled.
 * Returns undefined if devtools are not available.
 */
export const useDevtoolsSlide = (): GettingStartedSlide | undefined => {
  if (!import.meta.env?.VITE_ALEPHA_DEVTOOLS) {
    return undefined;
  }

  return {
    text: "Inspect everything.",
    sub: "DevTools are built in.",
    steps: [
      {
        num: "→",
        text: (
          <>
            Open{" "}
            <a href="/__devtools/" target="_blank" rel="noopener noreferrer">
              /__devtools
            </a>{" "}
            to explore your app
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
