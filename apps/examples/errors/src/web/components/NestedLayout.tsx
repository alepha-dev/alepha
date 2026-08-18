import { Link, NestedView } from "alepha/react/router";

const NestedLayout = () => {
  return (
    <div
      style={{
        maxWidth: 640,
        margin: "40px auto",
        fontFamily: "system-ui, sans-serif",
      }}
    >
      <h2>Nested Layout (parent)</h2>
      <p style={{ color: "#888", marginBottom: 16 }}>
        This parent renders fine. The child below crashes.
      </p>
      <nav style={{ display: "flex", gap: 8, marginBottom: 24 }}>
        <Link
          href="/nested"
          style={{
            padding: "6px 12px",
            border: "1px solid #444",
            borderRadius: 6,
            background: "#2a2a2a",
            color: "#eee",
            cursor: "pointer",
            textDecoration: "none",
          }}
        >
          OK child
        </Link>
        <Link
          href="/nested/render-error"
          style={{
            padding: "6px 12px",
            border: "1px solid #444",
            borderRadius: 6,
            background: "#2a2a2a",
            color: "#eee",
            cursor: "pointer",
            textDecoration: "none",
          }}
        >
          Child render error
        </Link>
        <Link
          href="/nested/loader-error"
          style={{
            padding: "6px 12px",
            border: "1px solid #444",
            borderRadius: 6,
            background: "#2a2a2a",
            color: "#eee",
            cursor: "pointer",
            textDecoration: "none",
          }}
        >
          Child loader error
        </Link>
      </nav>
      <div
        style={{
          border: "1px solid #333",
          borderRadius: 8,
          padding: 16,
          background: "#1a1a1a",
        }}
      >
        <NestedView />
      </div>
    </div>
  );
};

export default NestedLayout;
