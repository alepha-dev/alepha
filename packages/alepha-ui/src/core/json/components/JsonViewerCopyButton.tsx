import { ActionIcon } from "@mantine/core";
import { IconCheck, IconCopy } from "@tabler/icons-react";
import { useCallback, useState } from "react";

// =============================================================================
// PROPS
// =============================================================================

export interface JsonViewerCopyButtonProps {
  value: string;
  iconSize: number;
}

// =============================================================================
// COMPONENT
// =============================================================================

export const JsonViewerCopyButton = (props: JsonViewerCopyButtonProps) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      navigator.clipboard.writeText(props.value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    },
    [props.value],
  );

  return (
    <ActionIcon
      size={props.iconSize + 4}
      variant="transparent"
      c={copied ? "green" : "dimmed"}
      onClick={handleCopy}
      className="alepha-json-viewer-copy"
    >
      {copied ? (
        <IconCheck size={props.iconSize} />
      ) : (
        <IconCopy size={props.iconSize} />
      )}
    </ActionIcon>
  );
};
