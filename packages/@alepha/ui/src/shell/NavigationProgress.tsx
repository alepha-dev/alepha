import { useEvents } from "alepha/react";
import { useEffect, useRef, useState } from "react";

export interface NavigationProgressOptions {
  /**
   * Tailwind classes applied to the bar. Defaults to `bg-primary`.
   */
  className?: string;
  /**
   * Bar height in pixels. Defaults to 2.
   */
  height?: number;
}

/**
 * The top-of-viewport bar that fills while a route transition is in flight.
 *
 * ### Mount it at the ROOT of the application, not inside a shell
 *
 * The bar is driven by `react:transition:begin` / `react:transition:end`, and
 * a component only sees an event it is mounted for. That makes the placement
 * load-bearing rather than cosmetic:
 *
 * - `begin` fires before the destination's layers are built, and `NestedView`
 *   commits the new view on `end`. So a bar living inside the page being
 *   navigated *to* is mounted one beat too late to draw anything for the
 *   navigation that mounted it.
 * - A bar living inside the page being navigated *away from* unmounts at the
 *   same commit, halfway through its own fade-out.
 *
 * The consequence is that a bar mounted per-shell covers exactly the
 * navigations that stay inside that shell, and silently covers none of the
 * ones that enter or leave it. A landing page with no shell therefore looks
 * broken relative to the rest of the app: every move within a section has a
 * bar, and the move into the section has none.
 *
 * Mounted once in the root layout, it is alive for every transition the
 * application can make, which is the only placement that has no blind spot.
 * {@link AppShell} still mounts one by default for applications whose shell
 * *is* the root; those pass `progress={false}` once they hoist their own.
 */
export const NavigationProgress = (options: NavigationProgressOptions) => {
  const [progress, setProgress] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [visible, setVisible] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEvents(
    {
      "react:transition:begin": () => {
        // A second transition before the first ends used to leave the
        // first interval running for the page's lifetime.
        if (intervalRef.current) clearInterval(intervalRef.current);
        setProgress(0);
        setVisible(true);
        setIsLoading(true);
        let current = 0;
        intervalRef.current = setInterval(() => {
          current += (90 - current) * 0.1;
          setProgress(Math.min(90, current));
        }, 100);
      },
      "react:transition:end": () => {
        if (intervalRef.current) {
          clearInterval(intervalRef.current);
          intervalRef.current = null;
        }
        setProgress(100);
        setIsLoading(false);
        setTimeout(() => {
          setVisible(false);
          setProgress(0);
        }, 200);
      },
    },
    [],
  );

  useEffect(
    () => () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    },
    [],
  );

  if (!visible) return null;
  const height = options.height ?? 2;
  const barClassName = options.className ?? "bg-primary";
  return (
    <div
      aria-hidden
      data-testid="navigation-progress"
      className="pointer-events-none fixed top-0 right-0 left-0 z-50"
      style={{ height }}
    >
      <div
        className={`h-full ${barClassName}`}
        style={{
          width: `${progress}%`,
          transition: isLoading
            ? "width 0.1s ease-out"
            : "width 0.2s ease-out, opacity 0.2s ease-out",
          opacity: isLoading ? 1 : 0,
        }}
      />
    </div>
  );
};

export default NavigationProgress;
