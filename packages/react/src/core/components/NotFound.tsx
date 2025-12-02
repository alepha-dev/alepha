import type { CSSProperties } from "react";

export default function NotFoundPage(props: { style?: CSSProperties }) {
  return (
    <div
      style={{
        minHeight: "95vh",
        boxSizing: "border-box",
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        alignItems: "center",
        textAlign: "center",
        fontFamily:
          'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
        padding: "2rem",
        ...props.style,
      }}
    >
      <div style={{ fontSize: "6rem", fontWeight: 200, lineHeight: 1 }}>404</div>
      <div style={{ fontSize: "0.875rem", marginTop: "1rem", opacity: 0.6 }}>
        Page not found
      </div>
    </div>
  );
}
