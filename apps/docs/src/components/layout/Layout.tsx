import { useEvents } from "alepha/react";
import { NestedView, useRouterState } from "alepha/react/router";
import { useCallback, useEffect, useRef, useState } from "react";

import CommandPalette from "./CommandPalette.tsx";
import Header from "./Header.tsx";
import KeyboardShortcutsHelp from "./KeyboardShortcutsHelp.tsx";
import Sidebar from "./Sidebar.tsx";
import StatusBar from "./StatusBar.tsx";

import styles from "./Layout.module.css";

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
    <div className={styles.progressContainer}>
      <div
        className={styles.progressBar}
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
      className={styles.resizer}
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize sidebar"
      aria-valuenow={undefined}
      tabIndex={0}
    >
      {/* Subtle grip dots - only visible on hover */}
      <div
        className={`${styles.resizerGrip} ${isActive ? styles.resizerGripActive : ""}`}
        aria-hidden="true"
      >
        {[0, 1, 2].map((i) => (
          <div key={i} className={styles.resizerDot} />
        ))}
      </div>
      {/* Hover hitbox extension */}
      <div className={styles.resizerHitbox} aria-hidden="true" />
    </div>
  );
};

// =============================================================================
// LAYOUT
// =============================================================================

const Layout = () => {
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
  const [focusMode, setFocusMode] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(SIDEBAR_DEFAULT);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);
  const lastKeyRef = useRef<string>("");
  const lastKeyTimeRef = useRef<number>(0);

  // Load sidebar width from localStorage on mount
  useEffect(() => {
    // localStorage is client-only, so the width has to be seeded after mount or
    // the server and the hydration render disagree.
    // oxlint-disable-next-line react/set-state-in-effect
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

  // Home page layout - header without tabs, no sidebar
  if (!hasSidebar) {
    return (
      <div className="flex min-h-screen w-full flex-col">
        {/* Keyboard Shortcuts Help */}
        <KeyboardShortcutsHelp
          open={showHelp}
          onClose={() => setShowHelp(false)}
        />

        {/* Header without tabs - sticky */}
        <div className={styles.stickyHeader}>
          <Header showTabs={false} />
        </div>

        {/* Content */}
        <main id="main-content" className="flex-1" role="main">
          <NestedView />
        </main>

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
      <KeyboardShortcutsHelp
        open={showHelp}
        onClose={() => setShowHelp(false)}
      />

      {/* Focus Mode Notification */}
      {focusMode && (
        <div
          className={`${styles.notification} ${styles.focusNotification}`}
          role="status"
          aria-live="polite"
        >
          Focus mode • Press <kbd className={styles.focusKey}>f</kbd> or{" "}
          <kbd className={styles.focusKey}>Esc</kbd> to exit
        </div>
      )}

      {/* Mobile Sidebar Drawer */}
      {mobileSidebarOpen && (
        <div
          className={`visible-mobile fixed inset-0 ${styles.mobileOverlay}`}
          role="dialog"
          aria-modal="true"
          aria-label="Navigation menu"
        >
          {/* Backdrop */}
          <div
            className={`absolute inset-0 ${styles.mobileBackdrop}`}
            onClick={() => setMobileSidebarOpen(false)}
            aria-hidden="true"
          />
          {/* Drawer */}
          <div
            className={`absolute top-0 bottom-0 left-0 flex flex-col ${styles.mobileDrawer}`}
          >
            <Sidebar width={280} isMobileDrawer />
          </div>
        </div>
      )}

      {/* Main IDE Layout */}
      <div className="flex h-screen w-full flex-col">
        {/* Header with tabs */}
        {!focusMode && <Header showTabs />}

        {/* Main Content Area */}
        <div className={`flex w-full flex-1 ${styles.mainContainer}`}>
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
          <main
            ref={contentRef}
            id="main-content"
            className={`flex-1 ${styles.contentArea}`}
            role="main"
          >
            <NestedView />
          </main>
        </div>

        {/* Status Bar */}
        {!focusMode && <StatusBar />}
      </div>

      {/* Command Palette */}
      <CommandPalette />
    </div>
  );
};
