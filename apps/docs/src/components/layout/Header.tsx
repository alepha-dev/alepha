import { Link, useRouterState } from "@alepha/react";
import {
  IconBrandGithub,
  IconFile,
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
      className="flex bg-term"
      style={{
        height: 40,
        borderBottom: "1px solid var(--term-border)",
        position: "relative",
        zIndex: 100,
      }}
    >
      {/* Left - Menu Button & Tabs */}
      <div className="flex flex-1 items-center">
        {/* Alepha Logo/Home */}
        <Link
          href="/"
          className="flex items-center gap-2 px-4 h-full text-green border-r"
          style={{ textDecoration: "none" }}
        >
          <span style={{ fontSize: 16 }}>λ</span>
          <span className="font-semibold" style={{ fontSize: 13 }}>alepha</span>
        </Link>

        {/* Tabs - Only shown on docs pages */}
        {showTabs && <TabBar />}
      </div>

      {/* Right - Actions */}
      <div className="flex items-center gap-1 px-3">
        {/* Search Button */}
        <button
          type="button"
          onClick={() => {
            window.dispatchEvent(
              new KeyboardEvent("keydown", {
                key: "k",
                metaKey: true,
              }),
            );
          }}
          className="header-btn flex items-center gap-2 rounded transition-colors"
          style={{
            padding: "4px 8px",
            background: "transparent",
            border: "none",
            color: "var(--term-text-dim)",
            cursor: "pointer",
            fontSize: 12,
          }}
        >
          <IconSearch size={14} />
          <span style={{ fontSize: 11, opacity: 0.7 }}>⌘K</span>
        </button>

        {/* GitHub */}
        <HeaderButton
          icon={<IconBrandGithub size={16} />}
          href="https://github.com/feunard/alepha"
          target="_blank"
        />

        {/* Dark Mode Toggle */}
        <DarkModeToggle />
      </div>
    </header>
  );
};

export default Header;

// =============================================================================
// TAB BAR
// =============================================================================

const TabBar = () => {
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

  return (
    <div className="flex h-full items-end overflow-hidden">
      {tabs.map((tab) => (
        <Tab
          key={tab.path}
          path={tab.path}
          name={tab.name}
          isActive={tab.path === currentPath}
          onClose={() => setTabs((prev) => prev.filter((t) => t.path !== tab.path))}
        />
      ))}
    </div>
  );
};

// =============================================================================
// TAB
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
      className="flex items-center gap-2 px-3 border-r cursor-pointer"
      style={{
        height: 32,
        background: isActive ? "var(--term-bg-panel)" : "transparent",
        borderTop: isActive ? "1px solid var(--term-green)" : "1px solid transparent",
        color: isActive ? "var(--term-text)" : "var(--term-text-dim)",
        fontSize: 12,
        position: "relative",
        marginTop: isActive ? 0 : 2,
      }}
    >
      <Link
        href={path}
        className="flex items-center gap-1"
        style={{
          textDecoration: "none",
          color: "inherit",
        }}
      >
        <IconFile size={14} style={{ color: "var(--term-cyan)" }} />
        <span>{name}.md</span>
      </Link>

      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onClose();
        }}
        className="btn-reset tab-close flex items-center justify-center"
        style={{
          width: 16,
          height: 16,
          borderRadius: 3,
          color: "var(--term-text-dim)",
          opacity: isActive ? 1 : 0,
          transition: "opacity 0.1s",
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
  href?: string;
  target?: string;
  onClick?: () => void;
}) => {
  const Component = props.href ? "a" : "button";

  return (
    <Component
      href={props.href}
      target={props.target}
      onClick={props.onClick}
      className="header-btn flex items-center gap-1 rounded transition-colors"
      style={{
        padding: "4px 8px",
        background: "transparent",
        border: "none",
        color: "var(--term-text-dim)",
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

const THEME_KEY = "alepha-docs-theme";

const getInitialTheme = (): "dark" | "light" => {
  // Check localStorage first
  if (typeof window !== "undefined") {
    const stored = localStorage.getItem(THEME_KEY);
    if (stored === "light" || stored === "dark") {
      return stored;
    }
    // Check system preference
    if (window.matchMedia?.("(prefers-color-scheme: light)").matches) {
      return "light";
    }
  }
  return "dark";
};

const DarkModeToggle = () => {
  const [isDark, setIsDark] = useState(true);

  // Initialize theme on mount
  useEffect(() => {
    const theme = getInitialTheme();
    setIsDark(theme === "dark");
    document.documentElement.setAttribute("data-theme", theme);
  }, []);

  const toggle = useCallback(() => {
    const newTheme = isDark ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", newTheme);
    localStorage.setItem(THEME_KEY, newTheme);
    setIsDark(!isDark);
  }, [isDark]);

  return (
    <HeaderButton
      icon={isDark ? <IconSun size={16} /> : <IconMoon size={16} />}
      onClick={toggle}
    />
  );
};
