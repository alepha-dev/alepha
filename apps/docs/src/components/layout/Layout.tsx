import { NestedView, useRouterState } from "@alepha/react";
import { useCallback, useEffect, useState } from "react";
import { useKonamiCode } from "../../hooks/useKonamiCode.ts";
import CommandPalette from "./CommandPalette.tsx";
import Header from "./Header.tsx";
import Sidebar from "./Sidebar.tsx";
import StatusBar from "./StatusBar.tsx";

// Console Easter egg for developers
const logConsoleEasterEgg = () => {
  console.log(
    "%c" +
      `
     _    _            _
    / \\  | | ___ _ __ | |__   __ _
   / _ \\ | |/ _ \\ '_ \\| '_ \\ / _\` |
  / ___ \\| |  __/ |_) | | | | (_| |
 /_/   \\_\\_|\\___| .__/|_| |_|\\__,_|
                |_|
`,
    "color: #22c55e; font-family: monospace;",
  );
  console.log(
    "%c Welcome, fellow developer! %c\n" +
      "%c Try the Konami code for a surprise... %c\n" +
      "%c ↑ ↑ ↓ ↓ ← → ← → B A %c",
    "background: #22c55e; color: #0a0a0a; font-weight: bold; padding: 4px 8px; border-radius: 4px;",
    "",
    "color: #f59e0b;",
    "",
    "color: #06b6d4; font-family: monospace;",
    "",
  );
};

// =============================================================================
// LAYOUT
// =============================================================================

const Layout = () => {
  // Log console Easter egg on mount
  useEffect(() => {
    logConsoleEasterEgg();
  }, []);

  return <LayoutContent />;
};

export default Layout;

// =============================================================================
// LAYOUT CONTENT
// =============================================================================

const LayoutContent = () => {
  const state = useRouterState();
  const hasSidebar = state.layers.slice(-1)[0]?.route?.sidebar === true;
  const [hackerMode, setHackerMode] = useState(false);
  const [showHackerNotification, setShowHackerNotification] = useState(false);

  // Easter egg: Konami code activates hacker mode
  useKonamiCode(
    useCallback(() => {
      setHackerMode((prev) => !prev);
      setShowHackerNotification(true);

      // Trigger a glitch effect
      const glitch = document.createElement("div");
      glitch.className = "terminal-glitch";
      glitch.style.background = `linear-gradient(transparent 0%, rgba(34, 197, 94, 0.1) 50%, transparent 100%)`;
      document.body.appendChild(glitch);
      setTimeout(() => glitch.remove(), 150);

      // Hide notification after 3 seconds
      setTimeout(() => setShowHackerNotification(false), 3000);

      console.log(
        `%c ${hackerMode ? "HACKER MODE DEACTIVATED" : "🔓 HACKER MODE ACTIVATED"} `,
        `background: ${hackerMode ? "#ef4444" : "#22c55e"}; color: #0a0a0a; font-weight: bold; padding: 4px 8px; border-radius: 4px;`,
      );
    }, [hackerMode]),
  );

  // Apply hacker mode class to document
  useEffect(() => {
    if (hackerMode) {
      document.documentElement.classList.add("hacker-mode");
    } else {
      document.documentElement.classList.remove("hacker-mode");
    }
    return () => document.documentElement.classList.remove("hacker-mode");
  }, [hackerMode]);

  // Home page layout - header without tabs, no sidebar
  if (!hasSidebar) {
    return (
      <div className="flex flex-col min-h-screen w-full">
        {/* Header without tabs */}
        <Header showTabs={false} />

        {/* Content */}
        <div className="flex-1">
          <NestedView />
        </div>

        {/* Command Palette available everywhere */}
        <CommandPalette />
      </div>
    );
  }

  // Docs page layout - full IDE with sidebar
  return (
    <div className="terminal-page" style={{ minHeight: "100vh", width: "100%" }}>
      {/* CRT Overlay */}
      <div className="crt-overlay" />

      {/* Hacker Mode Notification */}
      {showHackerNotification && (
        <div
          className="fixed"
          style={{
            top: 60,
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 10001,
            background: hackerMode ? "var(--term-green)" : "var(--term-red)",
            color: "#0a0a0a",
            padding: "8px 16px",
            borderRadius: 4,
            fontWeight: 600,
            fontSize: 12,
            animation: "slideUp 0.3s ease",
          }}
        >
          {hackerMode ? "🔓 HACKER MODE ACTIVATED" : "HACKER MODE DEACTIVATED"}
        </div>
      )}

      {/* Main IDE Layout */}
      <div className="flex flex-col h-screen w-full">
        {/* Header with tabs */}
        <Header showTabs />

        {/* Main Content Area */}
        <div className="flex flex-1 w-full" style={{ overflow: "hidden" }}>
          {/* Sidebar - File Tree */}
          <Sidebar />

          {/* Content */}
          <div
            className="flex-1"
            style={{
              overflow: "auto",
              background: "var(--term-bg)",
            }}
          >
            <NestedView />
          </div>
        </div>

        {/* Status Bar */}
        <StatusBar hackerMode={hackerMode} />
      </div>

      {/* Command Palette */}
      <CommandPalette />
    </div>
  );
};
