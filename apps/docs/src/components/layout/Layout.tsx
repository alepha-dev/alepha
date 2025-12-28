import { NestedView, useEvents, useRouterState } from "@alepha/react";
import { IconLock, IconLockOpen } from "@tabler/icons-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useKonamiCode } from "../../hooks/useKonamiCode.ts";
import CommandPalette from "./CommandPalette.tsx";
import Header from "./Header.tsx";
import Sidebar from "./Sidebar.tsx";
import StatusBar from "./StatusBar.tsx";

// =============================================================================
// NAVIGATION PROGRESS BAR
// =============================================================================

const NavigationProgress = () => {
  const [isLoading, setIsLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [visible, setVisible] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEvents(
    {
      "react:transition:begin": () => {
        // Reset and start
        setProgress(0);
        setVisible(true);
        setIsLoading(true);

        // Simulate progress (starts fast, slows down as it approaches 90%)
        let currentProgress = 0;
        intervalRef.current = setInterval(() => {
          currentProgress += (90 - currentProgress) * 0.1;
          setProgress(Math.min(90, currentProgress));
        }, 100);
      },
      "react:transition:end": () => {
        // Clear interval and complete
        if (intervalRef.current) {
          clearInterval(intervalRef.current);
          intervalRef.current = null;
        }

        setProgress(100);
        setIsLoading(false);

        // Hide after animation completes
        setTimeout(() => {
          setVisible(false);
          setProgress(0);
        }, 200);
      },
    },
    [],
  );

  if (!visible) return null;

  return (
    <div
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        height: 3,
        zIndex: 9999,
        pointerEvents: "none",
      }}
    >
      <div
        style={{
          height: "100%",
          width: `${progress}%`,
          background: "var(--color-accent)",
          transition: isLoading
            ? "width 0.1s ease-out"
            : "width 0.2s ease-out, opacity 0.2s ease-out",
          opacity: isLoading ? 1 : 0,
        }}
      />
    </div>
  );
};

// =============================================================================
// KEYBOARD SHORTCUTS HELP
// =============================================================================

const KeyboardShortcutsHelp = (props: { onClose: () => void }) => {
  const [closing, setClosing] = useState(false);

  const handleClose = useCallback(() => {
    setClosing(true);
    setTimeout(() => {
      props.onClose();
    }, 120);
  }, [props.onClose]);

  // Handle Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !closing) {
        handleClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [closing, handleClose]);

  return (
    <div
      className="fixed inset-0 flex items-center justify-center dialog-overlay"
      style={{
        zIndex: 10002,
        background: "rgba(0, 0, 0, 0.7)",
        animation: closing
          ? "dialogOverlayOut 0.12s ease-in forwards"
          : undefined,
      }}
      onClick={handleClose}
    >
      <div
        className="dialog-container"
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "var(--color-bg-elevated)",
          border: "1px solid var(--color-border)",
          borderRadius: 8,
          padding: 24,
          maxWidth: 400,
          width: "90%",
          animation: closing ? "dialogOut 0.12s ease-in forwards" : undefined,
        }}
      >
        <div
          style={{
            fontSize: 14,
            fontWeight: 600,
            marginBottom: 16,
            color: "var(--color-accent)",
          }}
        >
          Keyboard Shortcuts
        </div>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 8,
            fontSize: 13,
          }}
        >
          {[
            ["j / k", "Scroll down / up"],
            ["g g", "Go to top"],
            ["G", "Go to bottom"],
            ["/", "Open search"],
            ["f", "Toggle focus mode"],
            ["Esc", "Close dialogs"],
            ["?", "Show this help"],
          ].map(([key, desc]) => (
            <div
              key={key}
              style={{
                display: "flex",
                justifyContent: "space-between",
                gap: 16,
              }}
            >
              <kbd
                style={{
                  background: "var(--color-bg)",
                  border: "1px solid var(--color-border)",
                  borderRadius: 4,
                  padding: "2px 8px",
                  fontFamily: "monospace",
                  fontSize: 12,
                  color: "var(--color-text)",
                }}
              >
                {key}
              </kbd>
              <span style={{ color: "var(--color-text-muted)" }}>{desc}</span>
            </div>
          ))}
        </div>
        <div
          style={{
            marginTop: 16,
            paddingTop: 16,
            borderTop: "1px solid var(--color-border)",
            fontSize: 11,
            color: "var(--color-text-muted)",
            textAlign: "center",
          }}
        >
          Press{" "}
          <kbd
            style={{
              background: "var(--color-bg)",
              padding: "1px 4px",
              borderRadius: 2,
            }}
          >
            Esc
          </kbd>{" "}
          or click outside to close
        </div>
      </div>
    </div>
  );
};

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
// SIDEBAR RESIZER
// =============================================================================

const SIDEBAR_MIN = 200;
const SIDEBAR_MAX = 500;
const SIDEBAR_DEFAULT = 280;
const SIDEBAR_WIDTH_KEY = "alepha-docs-sidebar-width";

const getInitialSidebarWidth = (): number => {
  if (typeof window !== "undefined") {
    const stored = localStorage.getItem(SIDEBAR_WIDTH_KEY);
    if (stored) {
      const width = Number.parseInt(stored, 10);
      if (width >= SIDEBAR_MIN && width <= SIDEBAR_MAX) {
        return width;
      }
    }
  }
  return SIDEBAR_DEFAULT;
};

const SidebarResizer = (props: {
  onResize: (width: number) => void;
  onResizeEnd: (width: number) => void;
}) => {
  const [isDragging, setIsDragging] = useState(false);
  const [isHovered, setIsHovered] = useState(false);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      setIsDragging(true);

      const onMouseMove = (e: MouseEvent) => {
        const newWidth = Math.min(
          SIDEBAR_MAX,
          Math.max(SIDEBAR_MIN, e.clientX),
        );
        props.onResize(newWidth);
      };

      const onMouseUp = (e: MouseEvent) => {
        setIsDragging(false);
        const finalWidth = Math.min(
          SIDEBAR_MAX,
          Math.max(SIDEBAR_MIN, e.clientX),
        );
        props.onResizeEnd(finalWidth);
        document.removeEventListener("mousemove", onMouseMove);
        document.removeEventListener("mouseup", onMouseUp);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      };

      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp);
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    },
    [props],
  );

  const isActive = isDragging || isHovered;

  return (
    <div
      onMouseDown={handleMouseDown}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      style={{
        width: 6,
        cursor: "col-resize",
        position: "relative",
        flexShrink: 0,
        zIndex: 10,
      }}
    >
      {/* Subtle grip dots - only visible on hover */}
      <div
        style={{
          position: "absolute",
          top: "50%",
          left: "50%",
          transform: "translate(-50%, -50%)",
          display: "flex",
          flexDirection: "column",
          gap: 3,
          opacity: isActive ? 0.5 : 0,
          transition: "opacity 0.15s ease",
        }}
      >
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            style={{
              width: 3,
              height: 3,
              borderRadius: "50%",
              background: "var(--color-text-muted)",
            }}
          />
        ))}
      </div>
      {/* Hover hitbox extension */}
      <div
        style={{
          position: "absolute",
          top: 0,
          bottom: 0,
          left: -3,
          right: -3,
        }}
      />
    </div>
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

  return (
    <>
      <NavigationProgress />
      <LayoutContent />
    </>
  );
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
  const [focusMode, setFocusMode] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(SIDEBAR_DEFAULT);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);
  const lastKeyRef = useRef<string>("");
  const lastKeyTimeRef = useRef<number>(0);

  // Load sidebar width from localStorage on mount
  useEffect(() => {
    setSidebarWidth(getInitialSidebarWidth());
  }, []);

  // Listen for keyboard help event from header button
  useEffect(() => {
    const handleShowHelp = () => setShowHelp(true);
    window.addEventListener("show-keyboard-help", handleShowHelp);
    return () =>
      window.removeEventListener("show-keyboard-help", handleShowHelp);
  }, []);

  // Listen for mobile sidebar toggle and close events
  useEffect(() => {
    const handleToggle = () => setMobileSidebarOpen((prev) => !prev);
    const handleClose = () => setMobileSidebarOpen(false);
    window.addEventListener("toggle-mobile-sidebar", handleToggle);
    window.addEventListener("close-mobile-sidebar", handleClose);
    return () => {
      window.removeEventListener("toggle-mobile-sidebar", handleToggle);
      window.removeEventListener("close-mobile-sidebar", handleClose);
    };
  }, []);

  const handleSidebarResize = useCallback((width: number) => {
    setSidebarWidth(width);
  }, []);

  const handleSidebarResizeEnd = useCallback((width: number) => {
    localStorage.setItem(SIDEBAR_WIDTH_KEY, String(width));
  }, []);

  // Scroll restoration and close mobile sidebar on navigation
  useEvents(
    {
      "react:transition:end": () => {
        contentRef.current?.scrollTo(0, 0);
        setMobileSidebarOpen(false);
      },
    },
    [],
  );

  // Keyboard shortcuts
  useEffect(() => {
    if (!hasSidebar) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore if typing in an input
      const target = e.target as HTMLElement;
      if (
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable
      ) {
        return;
      }

      const container = contentRef.current;
      const now = Date.now();

      // Handle key sequences (like gg)
      if (
        e.key === "g" &&
        lastKeyRef.current === "g" &&
        now - lastKeyTimeRef.current < 500
      ) {
        // gg - go to top
        container?.scrollTo({ top: 0, behavior: "smooth" });
        lastKeyRef.current = "";
        return;
      }

      lastKeyRef.current = e.key;
      lastKeyTimeRef.current = now;

      switch (e.key) {
        case "j":
          // Scroll down
          container?.scrollBy({ top: 100, behavior: "smooth" });
          break;
        case "k":
          // Scroll up
          container?.scrollBy({ top: -100, behavior: "smooth" });
          break;
        case "G":
          // Go to bottom
          container?.scrollTo({
            top: container.scrollHeight,
            behavior: "smooth",
          });
          break;
        case "f":
          // Toggle focus mode
          setFocusMode((prev) => !prev);
          break;
        case "/":
          // Open search (dispatch Cmd+K)
          e.preventDefault();
          window.dispatchEvent(
            new KeyboardEvent("keydown", {
              key: "k",
              metaKey: navigator.platform.toLowerCase().includes("mac"),
              ctrlKey: !navigator.platform.toLowerCase().includes("mac"),
            }),
          );
          break;
        case "?":
          // Show help
          setShowHelp(true);
          break;
        case "Escape":
          setShowHelp(false);
          setFocusMode(false);
          break;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [hasSidebar]);

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
        {/* Keyboard Shortcuts Help */}
        {showHelp && (
          <KeyboardShortcutsHelp onClose={() => setShowHelp(false)} />
        )}

        {/* Header without tabs - sticky */}
        <div style={{ position: "sticky", top: 0, zIndex: 100 }}>
          <Header showTabs={false} />
        </div>

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
    <div
      className="terminal-page"
      style={{ minHeight: "100vh", width: "100%" }}
    >
      {/* Keyboard Shortcuts Help */}
      {showHelp && <KeyboardShortcutsHelp onClose={() => setShowHelp(false)} />}

      {/* Hacker Mode Notification */}
      {showHackerNotification && (
        <div
          className="fixed"
          style={{
            top: 60,
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 10001,
            background: hackerMode ? "var(--color-accent)" : "var(--color-red)",
            color: "#0a0a0a",
            padding: "8px 16px",
            borderRadius: 4,
            fontWeight: 600,
            fontSize: 12,
            animation: "slideUp 0.3s ease",
          }}
        >
          <span className="flex items-center gap-2">
            {hackerMode ? <IconLockOpen size={14} /> : <IconLock size={14} />}
            {hackerMode ? "HACKER MODE ACTIVATED" : "HACKER MODE DEACTIVATED"}
          </span>
        </div>
      )}

      {/* Focus Mode Notification */}
      {focusMode && (
        <div
          className="fixed"
          style={{
            bottom: 40,
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 10001,
            background: "var(--color-bg-elevated)",
            border: "1px solid var(--color-border)",
            color: "var(--color-text-muted)",
            padding: "6px 12px",
            borderRadius: 4,
            fontSize: 11,
          }}
        >
          Focus mode • Press <kbd style={{ color: "var(--color-cyan)" }}>f</kbd>{" "}
          or <kbd style={{ color: "var(--color-cyan)" }}>Esc</kbd> to exit
        </div>
      )}

      {/* Mobile Sidebar Drawer */}
      {mobileSidebarOpen && (
        <div className="visible-mobile fixed inset-0" style={{ zIndex: 1000 }}>
          {/* Backdrop */}
          <div
            className="absolute inset-0"
            style={{ background: "rgba(0, 0, 0, 0.5)" }}
            onClick={() => setMobileSidebarOpen(false)}
          />
          {/* Drawer */}
          <div
            className="absolute top-0 left-0 bottom-0 flex flex-col"
            style={{
              width: 280,
              background: "var(--color-bg)",
              borderRight: "1px solid var(--color-border)",
              animation: "slideInLeft 0.2s ease",
            }}
          >
            <Sidebar width={280} isMobileDrawer />
          </div>
        </div>
      )}

      {/* Main IDE Layout */}
      <div className="flex flex-col h-screen w-full">
        {/* Header with tabs */}
        {!focusMode && <Header showTabs />}

        {/* Main Content Area */}
        <div
          className="flex flex-1 w-full"
          style={{ overflow: "hidden", position: "relative" }}
        >
          {/* Sidebar - File Tree */}
          {!focusMode && <Sidebar width={sidebarWidth} />}

          {/* Resizer */}
          {!focusMode && (
            <SidebarResizer
              onResize={handleSidebarResize}
              onResizeEnd={handleSidebarResizeEnd}
            />
          )}

          {/* Content */}
          <div
            ref={contentRef}
            className="flex-1"
            style={{
              overflow: "auto",
              background: "var(--color-bg)",
            }}
          >
            <NestedView />
          </div>
        </div>

        {/* Status Bar */}
        {!focusMode && <StatusBar hackerMode={hackerMode} />}
      </div>

      {/* Command Palette */}
      <CommandPalette />
    </div>
  );
};
