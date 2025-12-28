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

  return (
    <div className="mb-6 pb-4 border-b">
      {/* Breadcrumb Path */}
      <div className="flex items-center gap-1 mb-2 text-sm">
        <span style={{ color: "var(--term-green)" }}>alepha</span>
        <span style={{ color: "var(--term-text-dim)" }}>@</span>
        <span style={{ color: "var(--term-cyan)" }}>docs</span>
        <span style={{ color: "var(--term-text-dim)" }}>:</span>
        <span style={{ color: "var(--term-amber)" }}>~/{props.path || ""}</span>
        <span style={{ color: "var(--term-text-dim)" }}>$</span>
        <span style={{ color: "var(--term-text)" }}>cat README.md</span>
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
