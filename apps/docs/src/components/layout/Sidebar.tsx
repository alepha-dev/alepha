import { IconFile } from "@tabler/icons-react";
import { tree } from "../../config/docs.ts";
import { FileTree } from "./FileTree.tsx";

const Sidebar = () => {
  return (
    <div
      className="flex flex-col visible-md"
      style={{
        width: 280,
        background: "var(--term-bg-elevated)",
        borderRight: "1px solid var(--term-border)",
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
        Explorer
      </div>

      {/* File Tree */}
      <div className="flex-1 scroll-area p-2">
        <FileTree nodes={tree} depth={0} />
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
