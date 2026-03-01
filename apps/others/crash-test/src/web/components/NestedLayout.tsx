import { NestedView, useRouter } from "alepha/react/router";
import type { AppRouter } from "../AppRouter.ts";

const NestedLayout = () => {
  const router = useRouter<AppRouter>();

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
        <button
          type="button"
          onClick={() => router.push("nestedChildOk")}
          style={{
            padding: "6px 12px",
            border: "1px solid #444",
            borderRadius: 6,
            background: "#2a2a2a",
            color: "#eee",
            cursor: "pointer",
          }}
        >
          OK child
        </button>
        <button
          type="button"
          onClick={() => router.push("nestedChildRenderError")}
          style={{
            padding: "6px 12px",
            border: "1px solid #444",
            borderRadius: 6,
            background: "#2a2a2a",
            color: "#eee",
            cursor: "pointer",
          }}
        >
          Child render error
        </button>
        <button
          type="button"
          onClick={() => router.push("nestedChildLoaderError")}
          style={{
            padding: "6px 12px",
            border: "1px solid #444",
            borderRadius: 6,
            background: "#2a2a2a",
            color: "#eee",
            cursor: "pointer",
          }}
        >
          Child loader error
        </button>
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
