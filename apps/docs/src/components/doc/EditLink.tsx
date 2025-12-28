import { IconTerminal } from "@tabler/icons-react";
import { repository } from "../../config/docs.ts";

interface EditLinkProps {
  path?: string;
}

const EditLink = (props: EditLinkProps) => {
  if (!props.path) return null;

  return (
    <div className="mt-6 pt-4 border-t">
      <a
        href={`https://github.com/${repository.name}/edit/main/${props.path}`}
        target="_blank"
        rel="noopener noreferrer"
        className="edit-link flex items-center gap-2 text-sm rounded-md transition-colors"
        style={{
          color: "var(--term-text-dim)",
          textDecoration: "none",
          padding: "8px 12px",
          background: "var(--term-bg-panel)",
          border: "1px solid var(--term-border)",
          display: "inline-flex",
        }}
      >
        <IconTerminal size={14} />
        <span style={{ color: "var(--term-amber)" }}>$</span>
        <span>vim {props.path?.split("/").pop()}</span>
      </a>
    </div>
  );
};

export default EditLink;
