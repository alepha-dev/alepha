import { useAlepha } from "alepha/react";
import type { GettingStartedSlide } from "./GettingStarted.tsx";

/**
 * Hook that provides the devtools slide content.
 * Only shown in non-production environments where devtools are available.
 * Returns undefined if the app is running in production.
 */
export const useDevtoolsSlide = (): GettingStartedSlide | undefined => {
  const alepha = useAlepha();

  if (alepha.isProduction()) {
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
