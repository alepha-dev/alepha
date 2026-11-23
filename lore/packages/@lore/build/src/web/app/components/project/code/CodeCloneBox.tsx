import { Button, useToast } from "@alepha/ui";
import type { I18n } from "@lore/core/web";
import { useI18n } from "alepha/react/i18n";
import { Copy } from "lucide-react";

import { loreCloneTarget } from "./codeClone.ts";

export interface CodeCloneBoxProps {
  projectSlug: string;
  repoSlug: string;
  cloneUrl: string;
}

/**
 * How to get a repository (#Q4133): `lore clone`, which installs the
 * credential helper, and the plain `.git` URL for any other git client.
 */
const CodeCloneBox = (props: CodeCloneBoxProps) => {
  const { tr } = useI18n<I18n, "en">();
  const toaster = useToast();
  const lines = [
    {
      key: "lore",
      label: tr("code.clone.lore"),
      value: `lore clone ${loreCloneTarget(props.projectSlug, props.repoSlug)}`,
    },
    { key: "url", label: tr("code.clone.url"), value: props.cloneUrl },
  ];
  return (
    <div className="flex flex-col gap-2" data-testid="code-clone-box">
      {lines.map((line) => (
        <div key={line.key} className="flex items-center gap-2">
          <span className="text-muted-foreground w-12 shrink-0 text-xs">
            {line.label}
          </span>
          <code className="bg-muted grow overflow-x-auto rounded px-2 py-1 font-mono text-xs whitespace-nowrap">
            {line.value}
          </code>
          <Button
            size="sm"
            variant="outlined"
            aria-label={tr("code.clone.copy")}
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(line.value);
                toaster.success(tr("code.clone.copied"));
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
      ))}
    </div>
  );
};

export default CodeCloneBox;
