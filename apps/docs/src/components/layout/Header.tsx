import { Link, useRouter, useRouterState } from "@alepha/react/router";
import {
  IconBrandGithub,
  IconFile,
  IconGitBranch,
  IconKeyboard,
  IconMenu2,
  IconMoon,
  IconSearch,
  IconSun,
  IconX,
} from "@tabler/icons-react";
import { useCallback, useEffect, useState } from "react";

// =============================================================================
// HEADER - IDE STYLE
// =============================================================================

export interface HeaderProps {
  showTabs?: boolean;
}

const Header = (props: HeaderProps) => {
  const { showTabs = true } = props;

  return (
    <header
      className="flex bg-base"
      style={{
        height: 40,
        borderBottom: "1px solid var(--color-border)",
        position: "relative",
        zIndex: 100,
      }}
    >
      {/* Left - Menu Button & Tabs */}
      <div className="flex flex-1 items-center">
        {/* Mobile Menu Button - Only on docs pages */}
        {showTabs && (
          <button
            type="button"
            className="visible-mobile flex items-center justify-center h-full border-r"
            onClick={() =>
              window.dispatchEvent(new CustomEvent("toggle-mobile-sidebar"))
            }
            aria-label="Toggle sidebar menu"
            aria-expanded={false}
            style={{
              width: 44,
              background: "transparent",
              border: "none",
              color: "var(--color-text-muted)",
              cursor: "pointer",
            }}
          >
            <IconMenu2 size={20} />
          </button>
        )}

        {/* Alepha Logo/Home */}
        <Link
          href="/"
          className="logo-btn flex items-center gap-2 px-4 h-full border-r"
          style={{ textDecoration: "none", color: "var(--color-text-bright)" }}
        >
          <img
            src="/favicon.png"
            alt="Alepha"
            style={{ width: 32, height: 32, margin: "-8px" }}
          />
        </Link>

        {/* Version - Links to Changelog */}
        <Link
          href="/changelog"
          className="version-btn hidden-mobile flex items-center gap-2 px-4 h-full border-r"
          style={{
            color: "var(--color-text-muted)",
            fontSize: 12,
            textDecoration: "none",
          }}
          title="View Changelog"
        >
          <IconGitBranch size={14} />
          <span>v{import.meta.env.VITE_VERSION || "0.0.0"}</span>
        </Link>

        {/* Tabs - Only shown on docs pages, hidden on mobile */}
        {showTabs && (
          <div className="hidden-mobile">
            <TabBar />
          </div>
        )}
      </div>

      {/* Right - Actions */}
      <div className="flex items-center gap-1 px-3">
        {/* Search Button */}
        <SearchButton />

        {/* Keyboard Shortcuts */}
        <div className="hidden-mobile">
          <HeaderButton
            icon={<IconKeyboard size={16} />}
            title="Keyboard Shortcuts"
            onClick={() =>
              window.dispatchEvent(new CustomEvent("show-keyboard-help"))
            }
          />
        </div>

        {/* GitHub */}
        <HeaderButton
          icon={<IconBrandGithub size={16} />}
          title="View on GitHub"
          href="https://github.com/feunard/alepha"
          target="_blank"
        />

        {/* Dark/Light Mode Toggle */}
        <DarkModeToggle />
      </div>
    </header>
  );
};

export default Header;

// =============================================================================
// SEARCH BUTTON
// =============================================================================

const SearchButton = () => {
  const [isMac, setIsMac] = useState(true);

  useEffect(() => {
    setIsMac(navigator.platform.toLowerCase().includes("mac"));
  }, []);

  const openSearch = useCallback(() => {
    window.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "k",
        metaKey: isMac,
        ctrlKey: !isMac,
      }),
    );
  }, [isMac]);

  return (
    <button
      type="button"
      onClick={openSearch}
      title="Search"
      aria-label={`Search documentation (${isMac ? "⌘" : "Ctrl+"}K)`}
      className="header-btn flex items-center gap-2 rounded transition-colors"
      style={{
        padding: "4px 8px",
        background: "transparent",
        border: "none",
        color: "var(--color-text-muted)",
        cursor: "pointer",
        fontSize: 12,
      }}
    >
      <IconSearch size={14} />
      <span
        aria-hidden="true"
        style={{ fontSize: 11, color: "var(--color-text-muted)" }}
      >
        {isMac ? "⌘" : "Ctrl+"}K
      </span>
    </button>
  );
};

// =============================================================================
// TAB BAR
// =============================================================================

const TabBar = () => {
  const router = useRouter();
  const state = useRouterState();
  const currentPath = state.url?.pathname || "";
  const currentName =
    state.layers.slice(-1)[0]?.props?.name ||
    state.layers.slice(-1)[0]?.name ||
    currentPath.split("/").pop() ||
    "docs";

  // Store recently visited tabs
  const [tabs, setTabs] = useState<{ path: string; name: string }[]>([]);

  useEffect(() => {
    if (currentPath?.startsWith("/docs/")) {
      setTabs((prev) => {
        // Remove if already exists
        const filtered = prev.filter((t) => t.path !== currentPath);
        // Add to front
        const newTabs = [{ path: currentPath, name: currentName }, ...filtered];
        // Keep only last 5
        return newTabs.slice(0, 5);
      });
    }
  }, [currentPath, currentName]);

  const handleClose = useCallback(
    (closedPath: string) => {
      const isActive = closedPath === currentPath;
      setTabs((prev) => {
        const newTabs = prev.filter((t) => t.path !== closedPath);
        // If closing the active tab, navigate to the next most recent tab
        if (isActive && newTabs.length > 0) {
          router.go(newTabs[0].path);
        }
        return newTabs;
      });
    },
    [currentPath, router],
  );

  return (
    <div
      className="flex h-full items-center"
      style={{ paddingLeft: 12 }}
      role="tablist"
      aria-label="Open documents"
    >
      {tabs.map((tab) => (
        <Tab
          key={tab.path}
          path={tab.path}
          name={tab.name}
          isActive={tab.path === currentPath}
          onClose={() => handleClose(tab.path)}
        />
      ))}
    </div>
  );
};

// =============================================================================
// TAB - Clean pill-style tabs
// =============================================================================

const Tab = (props: {
  path: string;
  name: string;
  isActive: boolean;
  onClose: () => void;
}) => {
  const { path, name, isActive, onClose } = props;

  return (
    <div
      className={`pill-tab ${isActive ? "" : "tab-inactive"}`}
      role="tab"
      aria-selected={isActive}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        height: 28,
        padding: "0 12px",
        marginRight: 4,
        borderRadius: 6,
        background: isActive ? "var(--color-bg-panel)" : "transparent",
        border: isActive
          ? "1px solid var(--color-border)"
          : "1px solid transparent",
        color: isActive ? "var(--color-text)" : "var(--color-text-muted)",
        fontSize: 12,
        cursor: "pointer",
        transition: "all 0.15s ease",
      }}
    >
      <Link
        href={path}
        className="flex items-center gap-2"
        aria-current={isActive ? "page" : undefined}
        style={{
          textDecoration: "none",
          color: "inherit",
        }}
      >
        <IconFile
          size={14}
          style={{
            color: isActive ? "var(--color-cyan)" : "var(--color-text-muted)",
            transition: "color 0.15s ease",
          }}
        />
        <span
          style={{
            maxWidth: 120,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {name}.md
        </span>
      </Link>

      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onClose();
        }}
        aria-label={`Close ${name} tab`}
        className="btn-reset tab-close flex items-center justify-center"
        style={{
          width: 16,
          height: 16,
          borderRadius: 4,
          color: "var(--color-text-muted)",
          visibility: isActive ? "visible" : "hidden",
          transition: "all 0.15s ease",
        }}
      >
        <IconX size={12} />
      </button>
    </div>
  );
};

// =============================================================================
// HEADER BUTTON
// =============================================================================

const HeaderButton = (props: {
  icon: React.ReactNode;
  label?: string;
  title?: string;
  href?: string;
  target?: string;
  onClick?: () => void;
}) => {
  const Component = props.href ? "a" : "button";
  const isExternal = props.target === "_blank";
  const ariaLabel =
    isExternal && props.title
      ? `${props.title} (opens in new window)`
      : props.title;

  return (
    <Component
      href={props.href}
      target={props.target}
      rel={isExternal ? "noopener noreferrer" : undefined}
      onClick={props.onClick}
      title={props.title}
      aria-label={ariaLabel}
      className="header-btn flex items-center gap-1 rounded transition-colors"
      style={{
        padding: "4px 8px",
        background: "transparent",
        border: "none",
        color: "var(--color-text-muted)",
        cursor: "pointer",
        fontSize: 12,
        textDecoration: "none",
      }}
    >
      {props.icon}
      {props.label && <span>{props.label}</span>}
    </Component>
  );
};

// =============================================================================
// DARK MODE TOGGLE
// =============================================================================

const MODE_KEY = "alepha-docs-mode";

type Mode = "dark" | "light";

const getInitialMode = (): Mode => {
  if (typeof window !== "undefined") {
    const stored = localStorage.getItem(MODE_KEY);
    if (stored === "light" || stored === "dark") {
      return stored;
    }
    if (window.matchMedia?.("(prefers-color-scheme: light)").matches) {
      return "light";
    }
  }
  return "dark";
};

const DarkModeToggle = () => {
  const [mode, setMode] = useState<Mode>("dark");

  useEffect(() => {
    const initialMode = getInitialMode();
    setMode(initialMode);
    document.documentElement.setAttribute("data-theme", initialMode);
  }, []);

  const toggleMode = useCallback(() => {
    const newMode = mode === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", newMode);
    localStorage.setItem(MODE_KEY, newMode);
    setMode(newMode);
  }, [mode]);

  return (
    <HeaderButton
      icon={mode === "dark" ? <IconSun size={16} /> : <IconMoon size={16} />}
      title={mode === "dark" ? "Switch to Light Mode" : "Switch to Dark Mode"}
      onClick={toggleMode}
    />
  );
};
