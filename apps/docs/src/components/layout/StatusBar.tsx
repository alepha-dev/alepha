import { ClientOnly, useRouterState } from "@alepha/react";
import { useI18n } from "@alepha/react/i18n";
import { useEffect, useState } from "react";

interface StatusBarProps {
  hackerMode?: boolean;
}

const StatusBar = (props: StatusBarProps) => {
  const state = useRouterState();
  const { l } = useI18n();
  const currentPage = state.url?.pathname || "/";

  return (
    <div
      className="flex items-center px-4"
      style={{
        height: 24,
        background: "var(--term-bg-elevated)",
        borderTop: "1px solid var(--term-border)",
        fontSize: 12,
        color: "var(--term-text-dim)",
        fontFamily: "monospace",
      }}
    >
      {/* Left side */}
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-1">
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: "50%",
              background: "#22c55e",
              animation: "pulse 2s ease-in-out infinite",
              display: "inline-block",
            }}
          />
          <span>{props.hackerMode ? "root" : "ready"}</span>
        </div>

        <span style={{ color: "var(--term-border)" }}>│</span>

        <span>main</span>

        <span style={{ color: "var(--term-border)" }}>│</span>

        <span>TypeScript React</span>

        {props.hackerMode && (
          <>
            <span style={{ color: "var(--term-border)" }}>│</span>
            <span style={{ color: "var(--term-green)", fontWeight: 600 }}>
              🔓 HACKER
            </span>
          </>
        )}
      </div>

      {/* Right side */}
      <div className="flex items-center gap-4 ml-auto">
        <span>
          <ClientOnly>
            built{" "}
            {l(import.meta.env.VITE_BUILD_DATE?.split("T")[0] || "", {
              date: "fromNow",
            })}
          </ClientOnly>
        </span>

        <span style={{ color: "var(--term-border)" }}>│</span>

        <span style={{ color: "var(--term-cyan)" }}>
          {currentPage === "/" ? "home" : currentPage.replace("/docs/", "").replace(/-/g, "_")}.md
        </span>

        <span style={{ color: "var(--term-border)" }}>│</span>

        <LiveClock />
      </div>
    </div>
  );
};

export default StatusBar;

// =============================================================================
// LIVE CLOCK
// =============================================================================

const LiveClock = () => {
  const [time, setTime] = useState(new Date());

  useEffect(() => {
    const interval = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(interval);
  }, []);

  return (
    <ClientOnly>
      <span>{time.toLocaleTimeString("en-US", { hour12: false })}</span>
    </ClientOnly>
  );
};
