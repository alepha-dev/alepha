import { IconFold, IconFoldDown } from "@tabler/icons-react";
import { useState } from "react";

import { tree } from "../../config/docs.ts";
import { FileTree } from "./FileTree.tsx";

interface SidebarProps {
  width?: number;
  isMobileDrawer?: boolean;
}

const Sidebar = (props: SidebarProps) => {
  const { width = 280, isMobileDrawer = false } = props;
  const [expandKey, setExpandKey] = useState(0);
  const [defaultExpanded, setDefaultExpanded] = useState<boolean | undefined>(
    undefined,
  );

  const handleExpandAll = () => {
    setDefaultExpanded(true);
    setExpandKey((k) => k + 1);
  };

  const handleCollapseAll = () => {
    setDefaultExpanded(false);
    setExpandKey((k) => k + 1);
  };

  return (
    <nav
      className={
        isMobileDrawer ? "flex flex-col" : "sidebar-container flex flex-col"
      }
      aria-label="Documentation explorer"
      style={{
        width,
        minWidth: width,
        background: "var(--color-bg)",
        borderRight: isMobileDrawer ? "none" : "1px solid var(--color-border)",
        overflow: "hidden",
        height: "100%",
      }}
    >
      {/* Explorer Header */}
      <div
        className="flex items-center gap-2 px-4 py-2"
        style={{
          borderBottom: "1px solid var(--color-border)",
          fontSize: 11,
          textTransform: "uppercase",
          letterSpacing: 1,
          color: "var(--color-text-muted)",
        }}
      >
        <span>Explorer</span>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Action buttons */}
        <div
          className="flex items-center gap-1"
          role="group"
          aria-label="Explorer actions"
        >
          <button
            type="button"
            onClick={handleExpandAll}
            className="btn-reset explorer-action flex items-center justify-center"
            title="Expand All"
            aria-label="Expand all folders"
            style={{
              width: 20,
              height: 20,
              borderRadius: 3,
              color: "var(--color-text-muted)",
              transition: "all 0.15s ease",
            }}
          >
            <IconFoldDown size={14} />
          </button>
          <button
            type="button"
            onClick={handleCollapseAll}
            className="btn-reset explorer-action flex items-center justify-center"
            title="Collapse All"
            aria-label="Collapse all folders"
            style={{
              width: 20,
              height: 20,
              borderRadius: 3,
              color: "var(--color-text-muted)",
              transition: "all 0.15s ease",
            }}
          >
            <IconFold size={14} />
          </button>
        </div>
      </div>

      {/* File Tree */}
      <div
        className="scroll-area flex-1 p-2"
        style={{ overflowX: "hidden", overflowY: "auto" }}
      >
        <FileTree
          key={expandKey}
          nodes={tree}
          depth={0}
          defaultExpanded={defaultExpanded}
        />
      </div>
    </nav>
  );
};

export default Sidebar;
