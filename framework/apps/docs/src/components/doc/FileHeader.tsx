import { IconClock, IconGitBranch } from "@tabler/icons-react";
import { ClientOnly } from "alepha/react";
import { useI18n } from "alepha/react/i18n";

interface FileHeaderProps {
  name: string;
  path?: string;
  readingTime?: number;
  lastModified?: string | null;
}

// Strip sorting prefixes like "1-", "02-", "123-" from path segments
const stripSortPrefix = (path: string) =>
  path
    .split("/")
    .map((segment) => segment.replace(/^\d+-/, ""))
    .join("/");

const FileHeader = (props: FileHeaderProps) => {
  const { l } = useI18n();

  // Extract directory and filename from path
  const pathParts = props.path?.split("/") || [];
  const fileName = pathParts.pop() || "README.md";
  const directory = stripSortPrefix(pathParts.join("/"));

  return (
    <div className="mb-8 pt-6 pb-6">
      {/* Breadcrumb Path + Edit Button - Hidden on mobile */}
      <div className="hidden-mobile mb-2 flex flex-wrap items-center justify-between gap-4 text-sm">
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
          <span style={{ color: "var(--term-text)" }}>
            cat {fileName} | pretty
          </span>
        </div>
      </div>

      {/* Metadata */}
      <div className="flex flex-wrap items-center gap-4 text-sm">
        {props.readingTime && (
          <div className="text-muted flex items-center gap-1">
            <IconClock size={14} />
            <span>{props.readingTime} min read</span>
          </div>
        )}
        {props.lastModified && (
          <div className="text-muted flex items-center gap-1">
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
