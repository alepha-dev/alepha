import { CopyButton, Tooltip } from "@mantine/core";
import { IconCheck, IconCopy } from "@tabler/icons-react";
import ActionButton, { type ActionCommonProps } from "./ActionButton.tsx";

export interface ClipboardButtonProps
  extends Omit<ActionCommonProps, "onClick" | "icon"> {
  /**
   * The value to copy to the clipboard
   */
  value: string;

  /**
   * Timeout in ms to show the "Copied" state (default: 2000)
   */
  timeout?: number;

  /**
   * Label to show in tooltip when not copied (default: "Copy")
   */
  copyLabel?: string;

  /**
   * Label to show in tooltip when copied (default: "Copied")
   */
  copiedLabel?: string;
}

const ClipboardButton = (props: ClipboardButtonProps) => {
  const {
    value,
    timeout = 2000,
    copyLabel = "Copy",
    copiedLabel = "Copied",
    children,
    ...buttonProps
  } = props;

  return (
    <CopyButton value={value} timeout={timeout}>
      {({ copied, copy }) => (
        <Tooltip label={copied ? copiedLabel : copyLabel} openDelay={500}>
          <ActionButton
            color={copied ? "teal" : undefined}
            onClick={copy}
            icon={copied ? IconCheck : IconCopy}
            {...buttonProps}
          >
            {children}
          </ActionButton>
        </Tooltip>
      )}
    </CopyButton>
  );
};

export default ClipboardButton;
