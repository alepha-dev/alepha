import { Link, useRouterState } from "@alepha/react";
import {
  IconBrandGithub,
  IconFile,
  IconGitBranch,
  IconMoon,
  IconPalette,
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
          <img src="/favicon.png" alt="Alepha" style={{ width: 20, height: 20 }} />
          <span className="font-semibold" style={{ fontSize: 13 }}>alepha</span>
        </Link>

        {/* Version */}
        <div
          className="flex items-center gap-2 px-4 h-full border-r"
          style={{ color: "var(--term-text-dim)", fontSize: 12 }}
        >
          <IconGitBranch size={14} />
          <span>v{import.meta.env.VITE_VERSION || "0.0.0"}</span>
        </div>

        {/* Tabs - Only shown on docs pages */}
        {showTabs && <TabBar />}
      </div>

      {/* Right - Actions */}
      <div className="flex items-center gap-1 px-3">
        {/* Search Button */}
        <SearchButton />

        {/* GitHub */}
        <HeaderButton
          icon={<IconBrandGithub size={16} />}
          href="https://github.com/feunard/alepha"
          target="_blank"
        />

        {/* Theme Select */}
        <ThemeSelector />

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
      <span style={{ fontSize: 11, opacity: 0.7 }}>{isMac ? "⌘" : "Ctrl+"}K</span>
    </button>
  );
};

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
    <div
      className="flex h-full items-center"
      style={{ paddingLeft: 12 }}
    >
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
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        height: 28,
        padding: "0 12px",
        marginRight: 4,
        borderRadius: 6,
        background: isActive ? "var(--term-bg-panel)" : "transparent",
        border: isActive ? "1px solid var(--term-border)" : "1px solid transparent",
        color: isActive ? "var(--term-text)" : "var(--term-text-dim)",
        fontSize: 12,
        cursor: "pointer",
        transition: "all 0.15s ease",
      }}
    >
      <Link
        href={path}
        className="flex items-center gap-2"
        style={{
          textDecoration: "none",
          color: "inherit",
        }}
      >
        <IconFile
          size={14}
          style={{
            color: isActive ? "var(--term-cyan)" : "var(--term-text-dim)",
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
        className="btn-reset tab-close flex items-center justify-center"
        style={{
          width: 16,
          height: 16,
          borderRadius: 4,
          color: "var(--term-text-dim)",
          opacity: isActive ? 0.6 : 0,
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
// THEME SELECTOR & DARK MODE TOGGLE
// =============================================================================

const SCHEME_KEY = "alepha-docs-scheme";
const MODE_KEY = "alepha-docs-mode";

const SCHEMES = ["terminal", "github"] as const;
type Scheme = (typeof SCHEMES)[number];
type Mode = "dark" | "light";

const getThemeAttribute = (scheme: Scheme, mode: Mode): string => {
  if (scheme === "terminal") {
    return mode; // "dark" or "light"
  }
  return mode === "dark" ? "github" : "github-light";
};

const getInitialScheme = (): Scheme => {
  if (typeof window !== "undefined") {
    const stored = localStorage.getItem(SCHEME_KEY);
    if (stored && SCHEMES.includes(stored as Scheme)) {
      return stored as Scheme;
    }
  }
  return "terminal";
};

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

const ThemeSelector = () => {
  const [scheme, setScheme] = useState<Scheme>("terminal");

  useEffect(() => {
    const initialScheme = getInitialScheme();
    const initialMode = getInitialMode();
    setScheme(initialScheme);
    document.documentElement.setAttribute(
      "data-theme",
      getThemeAttribute(initialScheme, initialMode),
    );
  }, []);

  const cycleScheme = useCallback(() => {
    const currentIndex = SCHEMES.indexOf(scheme);
    const nextIndex = (currentIndex + 1) % SCHEMES.length;
    const nextScheme = SCHEMES[nextIndex];
    const currentMode = getInitialMode();

    document.documentElement.setAttribute(
      "data-theme",
      getThemeAttribute(nextScheme, currentMode),
    );
    localStorage.setItem(SCHEME_KEY, nextScheme);
    setScheme(nextScheme);
  }, [scheme]);

  return (
    <HeaderButton
      icon={<IconPalette size={16} />}
      onClick={cycleScheme}
    />
  );
};

const DarkModeToggle = () => {
  const [mode, setMode] = useState<Mode>("dark");

  useEffect(() => {
    const initialMode = getInitialMode();
    const initialScheme = getInitialScheme();
    setMode(initialMode);
    document.documentElement.setAttribute(
      "data-theme",
      getThemeAttribute(initialScheme, initialMode),
    );
  }, []);

  const toggleMode = useCallback(() => {
    const newMode = mode === "dark" ? "light" : "dark";
    const currentScheme = getInitialScheme();

    document.documentElement.setAttribute(
      "data-theme",
      getThemeAttribute(currentScheme, newMode),
    );
    localStorage.setItem(MODE_KEY, newMode);
    setMode(newMode);
  }, [mode]);

  return (
    <HeaderButton
      icon={mode === "dark" ? <IconSun size={16} /> : <IconMoon size={16} />}
      onClick={toggleMode}
    />
  );
};
