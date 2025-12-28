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
    <div className="pt-6 mb-8 pb-6">
      {/* Breadcrumb Path + Edit Button - Hidden on mobile */}
      <div className="hidden-mobile flex items-center justify-between mb-2 text-sm gap-4 flex-wrap">
        <div className="flex items-center gap-2">
          <div className="flex items-center">
            <span style={{ color: "var(--color-accent)" }}>alepha</span>
            <span style={{ color: "var(--color-text-muted)" }}>@</span>
            <span style={{ color: "var(--color-cyan)" }}>docs</span>
            <span style={{ color: "var(--color-text-muted)" }}>:</span>
            <span style={{ color: "var(--color-amber)" }}>
              ~{directory ? `/${directory}` : ""}
            </span>
            <span style={{ color: "var(--color-text-muted)" }}>$</span>
          </div>
          <span style={{ color: "var(--term-text)" }}>cat {fileName}</span>
        </div>
      </div>

      {/* Metadata */}
      <div className="flex gap-4 items-center flex-wrap text-sm">
        {props.readingTime && (
          <div className="flex gap-1 items-center text-muted">
            <IconClock size={14} />
            <span>{props.readingTime} min read</span>
          </div>
        )}
        {props.lastModified && (
          <div className="flex gap-1 items-center text-muted">
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
