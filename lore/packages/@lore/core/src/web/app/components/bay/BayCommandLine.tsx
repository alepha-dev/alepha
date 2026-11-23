import { Button, useToast } from "@alepha/ui";
import { Copy } from "lucide-react";

export interface BayCommandLineProps {
  command: string;
  copyLabel: string;
  copiedMessage: string;
  testId?: string;
}

/**
 * One shell command to run on the machine, with a button that copies it.
 *
 * The command is read off the page by somebody about to paste it into a root
 * shell, so it is shown whole, in one scrollable line, and never shortened.
 */
const BayCommandLine = (props: BayCommandLineProps) => {
  const toaster = useToast();

  return (
    <div className="flex items-center gap-2">
      <code
        className="bg-muted grow overflow-x-auto rounded px-2 py-1 font-mono text-xs whitespace-nowrap"
        data-testid={props.testId}
      >
        {props.command}
      </code>
      <Button
        size="sm"
        variant="outlined"
        aria-label={props.copyLabel}
        onClick={async () => {
          // The toast only after the write resolved: the clipboard call
          // rejects on an insecure context.
          try {
            await navigator.clipboard.writeText(props.command);
            toaster.success(props.copiedMessage);
          } catch (error) {
            toaster.error(
              error instanceof Error ? error.message : String(error),
            );
          }
        }}
      >
        <Copy />
      </Button>
    </div>
  );
};

export default BayCommandLine;
