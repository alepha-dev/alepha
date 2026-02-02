import type { Alepha } from "alepha";
import { type CSSProperties, useEffect, useRef, useState } from "react";

interface ErrorViewerProps {
  error: Error;
  alepha: Alepha;
}

interface StackFrame {
  fn: string;
  file: string;
  line: string;
  col: string;
  raw: string;
  isNodeModules: boolean;
}

const isBrowser = typeof window !== "undefined";

/**
 * Error viewer component - Terminal/brutalist aesthetic
 */
const ErrorViewer = ({ error, alepha }: ErrorViewerProps) => {
  const [expanded, setExpanded] = useState(false);
  const [showNodeModules, setShowNodeModules] = useState(false);
  const [visible, setVisible] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const isProduction = alepha.isProduction();

  // Animate in on mount
  useEffect(() => {
    const timer = setTimeout(() => setVisible(true), 10);
    return () => clearTimeout(timer);
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    if (!isBrowser) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "c" && !e.metaKey && !e.ctrlKey) {
        copyToClipboard(error.stack || error.message);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [error]);

  if (isProduction) {
    return <ErrorViewerProduction />;
  }

  const frames = parseStackTrace(error.stack);
  const appFrames = frames.filter((f) => !f.isNodeModules);
  const nodeModulesFrames = frames.filter((f) => f.isNodeModules);
  const visibleAppFrames = expanded ? appFrames : appFrames.slice(0, 5);
  const hiddenAppCount = appFrames.length - 5;
  const timestamp = new Date().toLocaleTimeString("en-US", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

  return (
    <div
      ref={containerRef}
      style={{
        ...styles.overlay,
        opacity: visible ? 1 : 0,
      }}
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="error-viewer-title"
    >
      {/* Scan lines effect */}
      <div style={styles.scanlines} aria-hidden="true" />

      <div
        style={{
          ...styles.container,
          transform: visible ? "translateY(0)" : "translateY(-20px)",
          opacity: visible ? 1 : 0,
        }}
      >
        {/* Terminal header bar */}
        <div style={styles.terminalBar}>
          <div style={styles.terminalDots}>
            <span style={{ ...styles.dot, backgroundColor: "#ff5f57" }} />
            <span style={{ ...styles.dot, backgroundColor: "#febc2e" }} />
            <span style={{ ...styles.dot, backgroundColor: "#28c840" }} />
          </div>
          <div style={styles.terminalTitle}>
            <span style={styles.terminalTitleText}>error — {timestamp}</span>
          </div>
          <div style={styles.terminalActions}>
            <kbd style={styles.kbd}>C</kbd>
            <span style={styles.kbdLabel}>copy</span>
          </div>
        </div>

        {/* Error header */}
        <Header error={error} />

        {/* Stack trace */}
        <div style={styles.stackSection}>
          <div style={styles.stackHeader}>
            <span style={styles.stackHeaderText}>STACK TRACE</span>
            <span style={styles.stackCount}>
              {appFrames.length} frames
              {nodeModulesFrames.length > 0 &&
                ` · ${nodeModulesFrames.length} in node_modules`}
            </span>
          </div>

          <div style={styles.frameList}>
            {visibleAppFrames.map((frame, i) => (
              <StackFrameRow
                key={`${frame.raw}-${i}`}
                frame={frame}
                index={i}
              />
            ))}

            {hiddenAppCount > 0 && !expanded && (
              <ExpandButton
                onClick={() => setExpanded(true)}
                label={`Show ${hiddenAppCount} more frames`}
              />
            )}

            {expanded && hiddenAppCount > 0 && (
              <ExpandButton
                onClick={() => setExpanded(false)}
                label="Collapse"
              />
            )}

            {nodeModulesFrames.length > 0 && (
              <>
                <button
                  type="button"
                  onClick={() => setShowNodeModules(!showNodeModules)}
                  style={styles.nodeModulesToggle}
                >
                  <span style={styles.nodeModulesIcon}>
                    {showNodeModules ? "▼" : "▶"}
                  </span>
                  <span style={styles.nodeModulesLabel}>node_modules</span>
                  <span style={styles.nodeModulesCount}>
                    {nodeModulesFrames.length}
                  </span>
                </button>

                {showNodeModules && (
                  <div style={styles.nodeModulesFrames}>
                    {nodeModulesFrames.map((frame, i) => (
                      <StackFrameRow
                        key={`nm-${frame.raw}-${i}`}
                        frame={frame}
                        index={appFrames.length + i}
                        dimmed
                      />
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        {/* Footer */}
        <div style={styles.footer}>
          <span style={styles.footerText}>
            Press <kbd style={styles.kbdInline}>C</kbd> to copy stack trace
          </span>
        </div>
      </div>
    </div>
  );
};

export default ErrorViewer;

// ---------------------------------------------------------------------------------------------------------------------

function parseStackTrace(stack?: string): StackFrame[] {
  if (!stack) return [];

  const lines = stack.split("\n").slice(1);
  const frames: StackFrame[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("at ")) continue;

    const frame = parseStackLine(trimmed);
    if (frame) frames.push(frame);
  }

  return frames;
}

function parseStackLine(line: string): StackFrame | null {
  const isNodeModules = line.includes("node_modules") || line.includes("node:");

  const withFn = line.match(/^at\s+(.+?)\s+\((.+):(\d+):(\d+)\)$/);
  if (withFn) {
    return {
      fn: withFn[1],
      file: withFn[2],
      line: withFn[3],
      col: withFn[4],
      raw: line,
      isNodeModules,
    };
  }

  const withoutFn = line.match(/^at\s+(.+):(\d+):(\d+)$/);
  if (withoutFn) {
    return {
      fn: "<anonymous>",
      file: withoutFn[1],
      line: withoutFn[2],
      col: withoutFn[3],
      raw: line,
      isNodeModules,
    };
  }

  return {
    fn: "",
    file: line.replace(/^at\s+/, ""),
    line: "",
    col: "",
    raw: line,
    isNodeModules,
  };
}

function copyToClipboard(text: string): Promise<boolean> {
  if (!isBrowser || !navigator.clipboard) {
    return Promise.resolve(false);
  }
  return navigator.clipboard
    .writeText(text)
    .then(() => true)
    .catch(() => false);
}

/**
 * Header with error badge and message
 */
function Header({ error }: { error: Error }) {
  const [copied, setCopied] = useState(false);
  const [hovered, setHovered] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);

  const handleCopy = async () => {
    const success = await copyToClipboard(error.stack || error.message);
    if (success) setCopied(true);
  };

  return (
    <div style={styles.header}>
      <div style={styles.headerRow}>
        {/* Glowing error indicator */}
        <div style={styles.errorIndicator}>
          <div style={styles.errorGlow} />
          <div style={styles.errorBadge}>{error.name}</div>
        </div>

        <button
          type="button"
          onClick={handleCopy}
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
          style={{
            ...styles.copyBtn,
            ...(hovered ? styles.copyBtnHover : {}),
          }}
        >
          {copied ? "✓ Copied" : "Copy"}
        </button>
      </div>

      <h1 id="error-viewer-title" style={styles.message}>
        {error.message}
      </h1>
    </div>
  );
}

/**
 * Single stack frame row
 */
function StackFrameRow({
  frame,
  index,
  dimmed = false,
}: {
  frame: StackFrame;
  index: number;
  dimmed?: boolean;
}) {
  const [hovered, setHovered] = useState(false);
  const isFirst = index === 0 && !dimmed;
  // Split on both / and \ to handle paths from different platforms
  const pathParts = frame.file.split(/[/\\]/);
  const fileName = pathParts.pop() || frame.file;
  const dirPath = frame.file.substring(0, frame.file.length - fileName.length);

  // Build vscode:// link for clickable paths
  const vsCodeLink =
    frame.file && frame.line
      ? `vscode://file${frame.file}:${frame.line}:${frame.col || 1}`
      : null;

  const content = (
    <>
      <div
        style={{
          ...styles.frameIndex,
          color: isFirst ? "#ff6b6b" : dimmed ? "#555" : "#666",
        }}
      >
        {String(index + 1).padStart(2, "0")}
      </div>
      <div style={styles.frameContent}>
        {frame.fn && (
          <div
            style={{
              ...styles.fnName,
              color: dimmed ? "#888" : "#f0f0f0",
            }}
          >
            {formatFunctionName(frame.fn)}
          </div>
        )}
        <div style={styles.filePath}>
          <span style={{ ...styles.dirPath, opacity: dimmed ? 0.6 : 0.8 }}>
            {dirPath}
          </span>
          <span
            style={{
              ...styles.fileName,
              color: dimmed ? "#5a9aba" : "#7cc4eb",
            }}
          >
            {fileName}
          </span>
          {frame.line && (
            <span
              style={{
                ...styles.lineCol,
                color: dimmed ? "#9a8a40" : "#e5b83a",
              }}
            >
              :{frame.line}
              {frame.col && `:${frame.col}`}
            </span>
          )}
        </div>
      </div>
    </>
  );

  const rowStyles: CSSProperties = {
    ...styles.frame,
    ...(isFirst ? styles.frameFirst : {}),
    backgroundColor: hovered ? "rgba(255,255,255,0.03)" : "transparent",
  };

  if (vsCodeLink && isBrowser) {
    return (
      <a
        href={vsCodeLink}
        style={{ ...rowStyles, textDecoration: "none" }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        {content}
      </a>
    );
  }

  return <div style={rowStyles}>{content}</div>;
}

/**
 * Format function name with syntax highlighting
 */
function formatFunctionName(fn: string): React.ReactNode {
  // Highlight async/Object/Class prefixes
  const asyncMatch = fn.match(/^(async\s+)?(.+)$/);
  if (asyncMatch?.[1]) {
    return (
      <>
        <span style={{ color: "#c678dd" }}>async </span>
        <span>{asyncMatch[2]}</span>
      </>
    );
  }

  // Highlight method calls like Object.method
  const methodMatch = fn.match(/^(.+)\.([^.]+)$/);
  if (methodMatch) {
    return (
      <>
        <span style={{ color: "#e5c07b" }}>{methodMatch[1]}</span>
        <span style={{ color: "#666" }}>.</span>
        <span>{methodMatch[2]}</span>
      </>
    );
  }

  return fn;
}

/**
 * Expand/collapse button
 */
function ExpandButton({
  onClick,
  label,
}: {
  onClick: () => void;
  label: string;
}) {
  const [hovered, setHovered] = useState(false);

  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        ...styles.expandBtn,
        backgroundColor: hovered ? "rgba(255,255,255,0.05)" : "transparent",
        color: hovered ? "#aaa" : "#777",
      }}
    >
      {label}
    </button>
  );
}

/**
 * Production error view - minimal, user-friendly
 */
function ErrorViewerProduction() {
  const [hovered, setHovered] = useState(false);

  const handleReload = () => {
    if (isBrowser) window.location.reload();
  };

  return (
    <div style={styles.overlay} role="alertdialog" aria-modal="true">
      <div style={styles.prodContainer}>
        <div style={styles.prodIcon}>
          <svg
            width="32"
            height="32"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
        </div>
        <h1 style={styles.prodTitle}>Something went wrong</h1>
        <p style={styles.prodMessage}>
          We encountered an unexpected error. Please try again.
        </p>
        <button
          type="button"
          onClick={handleReload}
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
          style={{
            ...styles.prodButton,
            backgroundColor: hovered ? "#333" : "#222",
            borderColor: hovered ? "#555" : "#444",
          }}
        >
          Reload page
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------------------------------------------------

const MONO_FONT =
  'ui-monospace, "JetBrains Mono", "Fira Code", SFMono-Regular, Menlo, Monaco, Consolas, monospace';

const styles: Record<string, CSSProperties> = {
  overlay: {
    position: "fixed",
    inset: 0,
    backgroundColor: "rgba(0, 0, 0, 0.92)",
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "center",
    padding: "40px 20px",
    overflow: "auto",
    fontFamily: MONO_FONT,
    fontSize: "13px",
    zIndex: 99999,
    transition: "opacity 0.2s ease-out",
  },

  scanlines: {
    position: "fixed",
    inset: 0,
    background:
      "repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,0,0,0.1) 2px, rgba(0,0,0,0.1) 4px)",
    pointerEvents: "none",
    zIndex: 100000,
  },

  container: {
    width: "100%",
    maxWidth: "900px",
    backgroundColor: "#0d0d0d",
    borderRadius: "8px",
    overflow: "hidden",
    boxShadow: "0 0 0 1px #333, 0 25px 80px -12px rgba(0, 0, 0, 0.8)",
    transition: "transform 0.3s ease-out, opacity 0.3s ease-out",
  },

  // Terminal bar
  terminalBar: {
    display: "flex",
    alignItems: "center",
    padding: "12px 16px",
    backgroundColor: "#1a1a1a",
    borderBottom: "1px solid #333",
  },

  terminalDots: {
    display: "flex",
    gap: "8px",
  },

  dot: {
    width: "12px",
    height: "12px",
    borderRadius: "50%",
  },

  terminalTitle: {
    flex: 1,
    textAlign: "center",
  },

  terminalTitleText: {
    color: "#777",
    fontSize: "12px",
    letterSpacing: "0.5px",
  },

  terminalActions: {
    display: "flex",
    alignItems: "center",
    gap: "6px",
  },

  kbd: {
    display: "inline-block",
    padding: "2px 6px",
    backgroundColor: "#2a2a2a",
    borderRadius: "4px",
    fontSize: "11px",
    color: "#aaa",
    border: "1px solid #444",
  },

  kbdInline: {
    display: "inline-block",
    padding: "1px 5px",
    backgroundColor: "#222",
    borderRadius: "3px",
    fontSize: "11px",
    color: "#888",
    border: "1px solid #444",
    marginLeft: "4px",
    marginRight: "4px",
  },

  kbdLabel: {
    color: "#777",
    fontSize: "11px",
  },

  // Header
  header: {
    padding: "24px",
    borderBottom: "1px solid #333",
  },

  headerRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: "16px",
  },

  errorIndicator: {
    position: "relative",
    display: "inline-flex",
  },

  errorGlow: {
    position: "absolute",
    inset: "-4px",
    background:
      "radial-gradient(ellipse at center, rgba(255,80,80,0.3) 0%, transparent 70%)",
    borderRadius: "12px",
    filter: "blur(8px)",
  },

  errorBadge: {
    position: "relative",
    display: "inline-block",
    padding: "6px 14px",
    backgroundColor: "#3d1a1a",
    color: "#ff7b7b",
    fontSize: "12px",
    fontWeight: 600,
    borderRadius: "6px",
    border: "1px solid #5a2828",
    letterSpacing: "0.5px",
  },

  copyBtn: {
    padding: "8px 14px",
    backgroundColor: "transparent",
    color: "#888",
    fontSize: "12px",
    fontWeight: 500,
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: "#444",
    borderRadius: "6px",
    cursor: "pointer",
    transition: "all 0.15s",
    fontFamily: MONO_FONT,
  },

  copyBtnHover: {
    backgroundColor: "#252525",
    color: "#bbb",
    borderColor: "#555",
  },

  message: {
    margin: 0,
    fontSize: "18px",
    fontWeight: 400,
    color: "#e8e8e8",
    lineHeight: 1.6,
    wordBreak: "break-word",
    fontFamily: MONO_FONT,
  },

  // Stack section
  stackSection: {
    borderTop: "1px solid #2a2a2a",
  },

  stackHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "14px 24px",
    borderBottom: "1px solid #2a2a2a",
  },

  stackHeaderText: {
    fontSize: "10px",
    fontWeight: 600,
    color: "#666",
    letterSpacing: "1.5px",
  },

  stackCount: {
    fontSize: "11px",
    color: "#555",
  },

  frameList: {
    display: "flex",
    flexDirection: "column",
  },

  frame: {
    display: "flex",
    alignItems: "flex-start",
    padding: "12px 24px",
    borderBottom: "1px solid #222",
    transition: "background-color 0.1s",
    cursor: "pointer",
  },

  frameFirst: {
    backgroundColor: "rgba(255, 80, 80, 0.08)",
    borderLeft: "2px solid #ff6b6b",
  },

  frameIndex: {
    width: "28px",
    flexShrink: 0,
    fontSize: "11px",
    fontWeight: 500,
    fontFamily: MONO_FONT,
  },

  frameContent: {
    flex: 1,
    minWidth: 0,
  },

  fnName: {
    fontSize: "13px",
    fontWeight: 500,
    marginBottom: "4px",
    fontFamily: MONO_FONT,
  },

  filePath: {
    fontSize: "12px",
    color: "#888",
    fontFamily: MONO_FONT,
    wordBreak: "break-all",
  },

  dirPath: {
    color: "#666",
  },

  fileName: {
    color: "#7cc4eb",
  },

  lineCol: {
    color: "#e5b83a",
  },

  expandBtn: {
    width: "100%",
    padding: "14px 24px",
    backgroundColor: "transparent",
    color: "#777",
    fontSize: "12px",
    fontWeight: 500,
    border: "none",
    borderTop: "1px solid #2a2a2a",
    cursor: "pointer",
    textAlign: "left",
    transition: "all 0.15s",
    fontFamily: MONO_FONT,
  },

  nodeModulesToggle: {
    display: "flex",
    alignItems: "center",
    gap: "10px",
    width: "100%",
    padding: "12px 24px",
    backgroundColor: "#0a0a0a",
    color: "#666",
    fontSize: "11px",
    fontWeight: 500,
    border: "none",
    borderTop: "1px solid #2a2a2a",
    cursor: "pointer",
    textAlign: "left",
    fontFamily: MONO_FONT,
  },

  nodeModulesIcon: {
    fontSize: "8px",
    color: "#555",
  },

  nodeModulesLabel: {
    flex: 1,
    letterSpacing: "0.5px",
  },

  nodeModulesCount: {
    color: "#555",
  },

  nodeModulesFrames: {
    backgroundColor: "#080808",
  },

  footer: {
    padding: "14px 24px",
    borderTop: "1px solid #2a2a2a",
    backgroundColor: "#0a0a0a",
  },

  footerText: {
    fontSize: "11px",
    color: "#555",
  },

  // Production styles
  prodContainer: {
    textAlign: "center",
    padding: "60px 40px",
    backgroundColor: "#0d0d0d",
    borderRadius: "8px",
    maxWidth: "400px",
    border: "1px solid #333",
  },

  prodIcon: {
    width: "64px",
    height: "64px",
    margin: "0 auto 24px",
    color: "#666",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },

  prodTitle: {
    margin: "0 0 12px",
    fontSize: "18px",
    fontWeight: 500,
    color: "#f0f0f0",
    fontFamily: MONO_FONT,
  },

  prodMessage: {
    margin: "0 0 28px",
    fontSize: "13px",
    color: "#888",
    lineHeight: 1.6,
    fontFamily: MONO_FONT,
  },

  prodButton: {
    padding: "12px 24px",
    backgroundColor: "#222",
    color: "#bbb",
    fontSize: "13px",
    fontWeight: 500,
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: "#444",
    borderRadius: "6px",
    cursor: "pointer",
    transition: "all 0.15s",
    fontFamily: MONO_FONT,
  },
};
