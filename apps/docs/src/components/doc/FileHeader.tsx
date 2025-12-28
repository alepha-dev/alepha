import { ClientOnly } from "@alepha/react";
import { useI18n } from "@alepha/react/i18n";
import { IconClock, IconGitBranch } from "@tabler/icons-react";

interface FileHeaderProps {
  name: string;
  path?: string;
  readingTime?: number;
  lastModified?: string | null;
}

const FileHeader = (props: FileHeaderProps) => {
  const { l } = useI18n();

  // Extract directory and filename from path
  const pathParts = props.path?.split("/") || [];
  const fileName = pathParts.pop() || "README.md";
  const directory = pathParts.join("/");

  return (
    <div className="pt-6 mb-8 pb-6 border-b">
      {/* Breadcrumb Path */}
      <div className="flex items-center mb-2 text-sm gap-1">
        <div>
          <span style={{ color: "var(--term-green)" }}>alepha</span>
          <span style={{ color: "var(--term-text-dim)" }}>@</span>
          <span style={{ color: "var(--term-cyan)" }}>docs</span>
          <span style={{ color: "var(--term-text-dim)" }}>:</span>
          <span style={{ color: "var(--term-amber)" }}>
            ~/docs{directory ? `/${directory}` : ""}
          </span>
          <span style={{ color: "var(--term-text-dim)" }}>$</span>
        </div>
        <span style={{ color: "var(--term-text)" }}>cat {fileName}</span>
      </div>

      {/* Metadata */}
      <div className="flex gap-4 items-center flex-wrap text-sm">
        {props.readingTime && (
          <div className="flex gap-1 items-center text-term-dim">
            <IconClock size={14} />
            <span>{props.readingTime} min read</span>
          </div>
        )}
        {props.lastModified && (
          <div className="flex gap-1 items-center text-term-dim">
            <IconGitBranch size={14} />
            <span>
              Last commit:{" "}
              <ClientOnly>
                {l(props.lastModified.split("T")[0], { date: "fromNow" })}
              </ClientOnly>
            </span>
          </div>
        )}
      </div>
    </div>
  );
};

export default FileHeader;
