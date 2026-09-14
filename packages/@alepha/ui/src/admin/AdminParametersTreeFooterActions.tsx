import * as React from "react";

void React;

import { useI18n } from "alepha/react/i18n";
import { Download, Upload } from "lucide-react";
import { useRef } from "react";

import { Button } from "../core/Button.tsx";

export interface AdminParametersTreeFooterActionsProps {
  onExportAll: () => void | Promise<void>;
  onImport: (file: File) => void | Promise<void>;
  disabled?: boolean;
  exporting?: boolean;
  importing?: boolean;
}

export const AdminParametersTreeFooterActions = (
  props: AdminParametersTreeFooterActionsProps,
) => {
  const { tr } = useI18n();
  const fileInput = useRef<HTMLInputElement>(null);
  return (
    <div className="flex items-center justify-center gap-2 border-t pt-2">
      <input
        ref={fileInput}
        type="file"
        accept="application/json,.json"
        className="hidden"
        onChange={async (e) => {
          const file = e.target.files?.[0];
          // Reset so the same file can be re-selected on a subsequent click.
          e.target.value = "";
          if (file) await props.onImport(file);
        }}
      />
      <Button
        type="button"
        variant="ghost"
        size="sm"
        disabled={props.disabled || props.exporting}
        onClick={() => props.onExportAll()}
      >
        <Download className="size-3.5" />
        {tr("admin.parameters.export", { default: "Export" })}
      </Button>
      <span aria-hidden className="bg-border h-4 w-px rotate-12" />
      <Button
        type="button"
        variant="ghost"
        size="sm"
        disabled={props.importing}
        onClick={() => fileInput.current?.click()}
      >
        <Upload className="size-3.5" />
        {tr("admin.parameters.import", { default: "Import" })}
      </Button>
    </div>
  );
};
