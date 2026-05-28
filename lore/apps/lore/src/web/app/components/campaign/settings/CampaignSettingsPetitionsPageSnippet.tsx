import { Button } from "@alepha/ui/components/ui/button";
import { Copy } from "lucide-react";

export interface CampaignSettingsPetitionsPageSnippetProps {
  label: string;
  code: string;
  onCopy: () => void;
  copyLabel: string;
}

const CampaignSettingsPetitionsPageSnippet = (
  props: CampaignSettingsPetitionsPageSnippetProps,
) => (
  <div className="flex flex-col gap-1.5">
    <div className="flex items-center justify-between">
      <span className="text-xs font-medium uppercase tracking-wide">
        {props.label}
      </span>
      <Button variant="outline" size="sm" onClick={props.onCopy}>
        <Copy className="size-3.5" />
        {props.copyLabel}
      </Button>
    </div>
    <pre className="bg-muted/40 max-h-64 overflow-auto rounded-md border p-3 font-mono text-xs">
      {props.code}
    </pre>
  </div>
);

export default CampaignSettingsPetitionsPageSnippet;
