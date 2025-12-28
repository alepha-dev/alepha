import {
  IconFile,
  IconFold,
  IconFoldDown,
} from "@tabler/icons-react";
import { useState } from "react";
import { tree } from "../../config/docs.ts";
import { FileTree } from "./FileTree.tsx";

const Sidebar = () => {
  const [expandKey, setExpandKey] = useState(0);
  const [defaultExpanded, setDefaultExpanded] = useState<boolean | undefined>(undefined);

  const handleExpandAll = () => {
    setDefaultExpanded(true);
    setExpandKey((k) => k + 1);
  };

  const handleCollapseAll = () => {
    setDefaultExpanded(false);
    setExpandKey((k) => k + 1);
  };

  return (
    <div
      className="sidebar-container flex flex-col texture-dots"
      style={{
        width: 280,
        background: "var(--term-bg-elevated)",
        borderRight: "1px solid var(--term-border)",
        overflow: "auto",
      }}
    >
      {/* Explorer Header */}
      <div
        className="flex items-center gap-2 px-4 py-2"
        style={{
          borderBottom: "1px solid var(--term-border)",
          fontSize: 11,
          textTransform: "uppercase",
          letterSpacing: 1,
          color: "var(--term-text-dim)",
        }}
      >
        <span>Explorer</span>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Action buttons */}
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={handleExpandAll}
            className="btn-reset flex items-center justify-center explorer-action"
            title="Expand All"
            style={{
              width: 20,
              height: 20,
              borderRadius: 3,
              color: "var(--term-text-dim)",
              transition: "all 0.15s ease",
            }}
          >
            <IconFoldDown size={14} />
          </button>
          <button
            type="button"
            onClick={handleCollapseAll}
            className="btn-reset flex items-center justify-center explorer-action"
            title="Collapse All"
            style={{
              width: 20,
              height: 20,
              borderRadius: 3,
              color: "var(--term-text-dim)",
              transition: "all 0.15s ease",
            }}
          >
            <IconFold size={14} />
          </button>
        </div>
      </div>

      {/* File Tree */}
      <div className="flex-1 scroll-area p-2" style={{ overflow: "auto" }}>
        <FileTree
          key={expandKey}
          nodes={tree}
          depth={0}
          defaultExpanded={defaultExpanded}
        />
      </div>

      {/* Bottom Links */}
      <div
        className="p-3"
        style={{
          borderTop: "1px solid var(--term-border)",
          fontSize: 12,
        }}
      >
        <a
          href="/llms.txt"
          target="_self"
          style={{
            color: "var(--term-text-dim)",
            textDecoration: "none",
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "4px 8px",
            borderRadius: 4,
          }}
        >
          <IconFile size={14} />
          <span>llms.txt</span>
        </a>
      </div>
    </div>
  );
};

export default Sidebar;
