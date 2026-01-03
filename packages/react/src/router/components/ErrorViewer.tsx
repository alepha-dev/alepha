import type { Alepha } from "alepha";
import { type CSSProperties, useState } from "react";

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
}

/**
 * Error viewer component that displays error details in development mode
 */
const ErrorViewer = ({ error, alepha }: ErrorViewerProps) => {
  const [expanded, setExpanded] = useState(false);
  const isProduction = alepha.isProduction();

  if (isProduction) {
    return <ErrorViewerProduction />;
  }

  const frames = parseStackTrace(error.stack);
  const visibleFrames = expanded ? frames : frames.slice(0, 6);
  const hiddenCount = frames.length - 6;

  return (
    <div style={styles.overlay}>
      <div style={styles.container}>
        <Header error={error} />
        <StackTraceSection
          frames={frames}
          visibleFrames={visibleFrames}
          expanded={expanded}
          hiddenCount={hiddenCount}
          onToggle={() => setExpanded(!expanded)}
        />
      </div>
    </div>
  );
};

export default ErrorViewer;

// ---------------------------------------------------------------------------------------------------------------------

/**
 * Parse stack trace string into structured frames
 */
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

/**
 * Parse a single stack trace line into a structured frame
 */
function parseStackLine(line: string): StackFrame | null {
  const withFn = line.match(/^at\s+(.+?)\s+\((.+):(\d+):(\d+)\)$/);
  if (withFn) {
    return {
      fn: withFn[1],
      file: withFn[2],
      line: withFn[3],
      col: withFn[4],
      raw: line,
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
    };
  }

  return { fn: "", file: line.replace(/^at\s+/, ""), line: "", col: "", raw: line };
}

/**
 * Copy text to clipboard
 */
function copyToClipboard(text: string): void {
  navigator.clipboard.writeText(text).catch((err) => {
    console.error("Clipboard error:", err);
  });
}

/**
 * Header section with error type and message
 */
function Header({ error }: { error: Error }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    copyToClipboard(error.stack || error.message);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div style={styles.header}>
      <div style={styles.headerTop}>
        <div style={styles.badge}>{error.name}</div>
        <button type="button" onClick={handleCopy} style={styles.copyBtn}>
          {copied ? "Copied" : "Copy Stack"}
        </button>
      </div>
      <h1 style={styles.message}>{error.message}</h1>
    </div>
  );
}

/**
 * Stack trace section with expandable frames
 */
function StackTraceSection({
  frames,
  visibleFrames,
  expanded,
  hiddenCount,
  onToggle,
}: {
  frames: StackFrame[];
  visibleFrames: StackFrame[];
  expanded: boolean;
  hiddenCount: number;
  onToggle: () => void;
}) {
  if (frames.length === 0) return null;

  return (
    <div style={styles.stackSection}>
      <div style={styles.stackHeader}>Call Stack</div>
      <div style={styles.frameList}>
        {visibleFrames.map((frame, i) => (
          <StackFrameRow key={i} frame={frame} index={i} />
        ))}
        {!expanded && hiddenCount > 0 && (
          <button type="button" onClick={onToggle} style={styles.expandBtn}>
            Show {hiddenCount} more frames
          </button>
        )}
        {expanded && hiddenCount > 0 && (
          <button type="button" onClick={onToggle} style={styles.expandBtn}>
            Show less
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * Single stack frame row
 */
function StackFrameRow({ frame, index }: { frame: StackFrame; index: number }) {
  const isFirst = index === 0;
  const fileName = frame.file.split("/").pop() || frame.file;
  const dirPath = frame.file.substring(0, frame.file.length - fileName.length);

  return (
    <div
      style={{
        ...styles.frame,
        ...(isFirst ? styles.frameFirst : {}),
      }}
    >
      <div style={styles.frameIndex}>{index + 1}</div>
      <div style={styles.frameContent}>
        {frame.fn && (
          <div style={styles.fnName}>
            {frame.fn}
          </div>
        )}
        <div style={styles.filePath}>
          <span style={styles.dirPath}>{dirPath}</span>
          <span style={styles.fileName}>{fileName}</span>
          {frame.line && (
            <span style={styles.lineCol}>
              :{frame.line}:{frame.col}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Production error view - minimal information
 */
function ErrorViewerProduction() {
  return (
    <div style={styles.overlay}>
      <div style={styles.prodContainer}>
        <div style={styles.prodIcon}>!</div>
        <h1 style={styles.prodTitle}>Application Error</h1>
        <p style={styles.prodMessage}>
          An unexpected error occurred. Please try again later.
        </p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          style={styles.prodButton}
        >
          Reload Page
        </button>
      </div>
    </div>
  );
}

const styles: Record<string, CSSProperties> = {
  overlay: {
    position: "fixed",
    inset: 0,
    backgroundColor: "rgba(0, 0, 0, 0.8)",
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "center",
    padding: "40px 20px",
    overflow: "auto",
    fontFamily:
      '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
    zIndex: 99999,
  },
  container: {
    width: "100%",
    maxWidth: "960px",
    backgroundColor: "#1a1a1a",
    borderRadius: "12px",
    overflow: "hidden",
    boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.5)",
  },
  header: {
    padding: "24px 28px",
    borderBottom: "1px solid #333",
    background: "linear-gradient(to bottom, #1f1f1f, #1a1a1a)",
  },
  headerTop: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: "16px",
  },
  badge: {
    display: "inline-block",
    padding: "6px 12px",
    backgroundColor: "#dc2626",
    color: "#fff",
    fontSize: "12px",
    fontWeight: 600,
    borderRadius: "6px",
    letterSpacing: "0.025em",
  },
  copyBtn: {
    padding: "8px 16px",
    backgroundColor: "transparent",
    color: "#888",
    fontSize: "13px",
    fontWeight: 500,
    border: "1px solid #444",
    borderRadius: "6px",
    cursor: "pointer",
    transition: "all 0.15s",
  },
  message: {
    margin: 0,
    fontSize: "20px",
    fontWeight: 500,
    color: "#fff",
    lineHeight: 1.5,
    wordBreak: "break-word",
  },
  stackSection: {
    padding: "0",
  },
  stackHeader: {
    padding: "16px 28px",
    fontSize: "11px",
    fontWeight: 600,
    color: "#666",
    textTransform: "uppercase",
    letterSpacing: "0.1em",
    borderBottom: "1px solid #2a2a2a",
  },
  frameList: {
    display: "flex",
    flexDirection: "column",
  },
  frame: {
    display: "flex",
    alignItems: "flex-start",
    padding: "14px 28px",
    borderBottom: "1px solid #252525",
    transition: "background-color 0.15s",
  },
  frameFirst: {
    backgroundColor: "rgba(220, 38, 38, 0.1)",
  },
  frameIndex: {
    width: "28px",
    flexShrink: 0,
    fontSize: "12px",
    fontWeight: 500,
    color: "#555",
    fontFamily: "monospace",
  },
  frameContent: {
    flex: 1,
    minWidth: 0,
  },
  fnName: {
    fontSize: "14px",
    fontWeight: 500,
    color: "#e5e5e5",
    marginBottom: "4px",
    fontFamily:
      'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
  },
  filePath: {
    fontSize: "13px",
    color: "#888",
    fontFamily:
      'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
    wordBreak: "break-all",
  },
  dirPath: {
    color: "#555",
  },
  fileName: {
    color: "#0ea5e9",
  },
  lineCol: {
    color: "#eab308",
  },
  expandBtn: {
    padding: "16px 28px",
    backgroundColor: "transparent",
    color: "#666",
    fontSize: "13px",
    fontWeight: 500,
    border: "none",
    borderTop: "1px solid #252525",
    cursor: "pointer",
    textAlign: "left",
    transition: "all 0.15s",
  },
  prodContainer: {
    textAlign: "center",
    padding: "60px 40px",
    backgroundColor: "#1a1a1a",
    borderRadius: "12px",
    maxWidth: "400px",
  },
  prodIcon: {
    width: "64px",
    height: "64px",
    margin: "0 auto 24px",
    backgroundColor: "#dc2626",
    borderRadius: "50%",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: "32px",
    fontWeight: 700,
    color: "#fff",
  },
  prodTitle: {
    margin: "0 0 12px",
    fontSize: "24px",
    fontWeight: 600,
    color: "#fff",
  },
  prodMessage: {
    margin: "0 0 28px",
    fontSize: "15px",
    color: "#888",
    lineHeight: 1.6,
  },
  prodButton: {
    padding: "12px 24px",
    backgroundColor: "#fff",
    color: "#000",
    fontSize: "14px",
    fontWeight: 600,
    border: "none",
    borderRadius: "8px",
    cursor: "pointer",
  },
};
