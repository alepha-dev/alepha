import { IconCheck, IconCopy } from "@tabler/icons-react";
import { useCallback, useState } from "react";

export interface CopyCommandProps {
  command: string;
}

const CopyCommand = (props: CopyCommandProps) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    void navigator.clipboard.writeText(props.command);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [props.command]);

  return (
    <div className="copy-command">
      <span className="copy-command-prompt">{">_"}</span>
      <code className="copy-command-text">{props.command}</code>
      <button
        type="button"
        onClick={handleCopy}
        aria-label={
          copied ? "Copied to clipboard" : "Copy command to clipboard"
        }
        className="copy-btn"
      >
        {copied ? (
          <IconCheck size={18} aria-hidden="true" />
        ) : (
          <IconCopy size={18} aria-hidden="true" />
        )}
      </button>
    </div>
  );
};

export default CopyCommand;
