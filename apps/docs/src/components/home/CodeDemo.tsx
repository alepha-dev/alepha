import { useState } from "react";
import { snippets } from "../../config/docs.ts";

const CODE_TABS = [
  { key: "server", label: "Server" },
  { key: "react", label: "React" },
  { key: "db", label: "ORM" },
  { key: "queue", label: "Queue" },
  { key: "command", label: "CLI" },
] as const;

const CodeSnippet = ({ html }: { html: string }) => (
  <div
    className="code-demo-content"
    // biome-ignore lint/security/noDangerouslySetInnerHtml: HTML is sanitized at build time
    dangerouslySetInnerHTML={{ __html: html }}
  />
);

const CodeDemo = () => {
  const [activeTab, setActiveTab] = useState(0);
  const activeKey = CODE_TABS[activeTab].key;

  return (
    <div className="w-full" style={{ maxWidth: 750, margin: "0 auto" }}>
      {/* Code Window */}
      <div
        style={{
          background: "var(--color-bg-panel)",
          border: "1px solid var(--color-border)",
          borderRadius: 10,
          overflow: "hidden",
          boxShadow: "0px 0px 0px 4px #ffffff14",
        }}
      >
        {/* Title bar */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            padding: "12px 16px",
            background: "var(--code-header-bg)",
            borderBottom: "1px solid var(--color-border)",
            gap: 12,
          }}
        >
          {/* Traffic lights */}
          <div style={{ display: "flex", gap: 8 }}>
            <div
              style={{
                width: 12,
                height: 12,
                borderRadius: "50%",
                background: "#ff5f57",
              }}
            />
            <div
              style={{
                width: 12,
                height: 12,
                borderRadius: "50%",
                background: "#febc2e",
              }}
            />
            <div
              style={{
                width: 12,
                height: 12,
                borderRadius: "50%",
                background: "#28c840",
              }}
            />
          </div>

          {/* Tabs */}
          <div
            style={{
              display: "flex",
              gap: 4,
              flex: 1,
              justifyContent: "center",
            }}
          >
            {CODE_TABS.map((tab, index) => (
              <button
                key={tab.key}
                type="button"
                onClick={() => setActiveTab(index)}
                className="pill-tab"
                style={{
                  display: "flex",
                  alignItems: "center",
                  height: 28,
                  padding: "0 14px",
                  borderRadius: 6,
                  background:
                    activeTab === index
                      ? "var(--color-bg-panel)"
                      : "transparent",
                  border:
                    activeTab === index
                      ? "1px solid var(--color-border)"
                      : "1px solid transparent",
                  color:
                    activeTab === index
                      ? "var(--color-text)"
                      : "var(--color-text-muted)",
                  fontSize: 12,
                  fontFamily: "inherit",
                  fontWeight: 500,
                  cursor: "pointer",
                  transition: "all 0.15s ease",
                }}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Spacer for symmetry */}
          <div style={{ width: 52 }} />
        </div>

        {/* Code content from snippets */}
        <div
          style={{
            height: 455,
            width: 600,
            overflow: "hidden",
            background: "var(--code-bg)",
          }}
        >
          <CodeSnippet html={snippets[activeKey]} />
        </div>
      </div>
    </div>
  );
};

export default CodeDemo;
