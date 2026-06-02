import { Button } from "@alepha/ui/components/ui/button";
import { Checkbox } from "@alepha/ui/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@alepha/ui/components/ui/dialog";
import { Input } from "@alepha/ui/components/ui/input";
import { Label } from "@alepha/ui/components/ui/label";
import { Textarea } from "@alepha/ui/components/ui/textarea";
import { useI18n } from "alepha/react/i18n";
import { useEffect, useState } from "react";
import type { SigilResource } from "@/api/controllers/SigilController.ts";
import { SIGIL_KINDS, type SigilKind } from "@/api/entities/sigils.ts";
import type { I18n } from "@/web/app/services/I18n.ts";

type KindLabelKey =
  | "sigils.kind.petition"
  | "sigils.kind.blights"
  | "sigils.kind.beacon"
  | "sigils.kind.vitals";

/**
 * Per-kind UI metadata for the dialog's capability checkboxes — keyed off
 * the shared `SIGIL_KINDS` constant so the literal list never drifts. The
 * `feature` is the campaign-level toggle that gates the checkbox.
 */
const KIND_META: Record<
  (typeof SIGIL_KINDS)[number],
  { labelKey: KindLabelKey; feature: string }
> = {
  petition: { labelKey: "sigils.kind.petition", feature: "petitions" },
  blights: { labelKey: "sigils.kind.blights", feature: "blights" },
  beacon: { labelKey: "sigils.kind.beacon", feature: "beacon" },
  vitals: { labelKey: "sigils.kind.vitals", feature: "vitals" },
};

export interface SigilFormValue {
  label: string;
  allowedOrigins: string[];
  kinds: SigilKind[];
  excludedPaths: string[];
}

export interface SigilFormDialogProps {
  open: boolean;
  /** When set, the dialog is in EDIT mode (pre-filled); otherwise CREATE. */
  sigil?: SigilResource;
  /** Campaign-level feature flags gating each `kind` checkbox. */
  featureEnabled: Record<string, boolean>;
  onOpenChange: (open: boolean) => void;
  onSubmit: (value: SigilFormValue) => Promise<void>;
}

/**
 * Create / Edit sigil form, hosted in a `@alepha/ui` `Dialog`. The same
 * component backs both flows: when `sigil` is provided the fields are
 * pre-filled and the dialog runs in edit mode. The capability checkboxes
 * stay gated on the campaign features exactly like the old inline form.
 */
const SigilFormDialog = (props: SigilFormDialogProps) => {
  const { tr } = useI18n<I18n, "en">();
  const isEdit = !!props.sigil;

  const [label, setLabel] = useState("");
  const [originsText, setOriginsText] = useState("");
  const [excludedPathsText, setExcludedPathsText] = useState("");
  const [kinds, setKinds] = useState<SigilKind[]>([]);
  const [saving, setSaving] = useState(false);

  // Re-seed the form whenever the dialog opens (pre-fill in edit mode,
  // blank in create mode).
  useEffect(() => {
    if (!props.open) return;
    setLabel(props.sigil?.label ?? "");
    setOriginsText((props.sigil?.allowedOrigins ?? []).join("\n"));
    setExcludedPathsText((props.sigil?.excludedPaths ?? []).join("\n"));
    setKinds((props.sigil?.kinds ?? []) as SigilKind[]);
    setSaving(false);
  }, [props.open, props.sigil]);

  const submit = async () => {
    if (!label.trim()) return;
    setSaving(true);
    try {
      const allowedOrigins = originsText
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean);
      const excludedPaths = excludedPathsText
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean);
      await props.onSubmit({
        label: label.trim(),
        allowedOrigins,
        kinds,
        excludedPaths,
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {tr(
              isEdit ? "sigils.dialog.editTitle" : "sigils.dialog.createTitle",
            )}
          </DialogTitle>
          <DialogDescription>
            {tr(
              isEdit
                ? "sigils.dialog.editDescription"
                : "sigils.dialog.createDescription",
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="sigil-label">{tr("sigils.create.label")}</Label>
            <Input
              id="sigil-label"
              value={label}
              placeholder={tr("sigils.create.labelPlaceholder")}
              onChange={(e) => setLabel(e.target.value)}
              autoFocus
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="sigil-origins">{tr("sigils.create.origins")}</Label>
            <Textarea
              id="sigil-origins"
              value={originsText}
              placeholder={tr("sigils.create.originsPlaceholder")}
              onChange={(e) => setOriginsText(e.target.value)}
              rows={3}
            />
            <span className="text-muted-foreground text-xs">
              {tr("sigils.create.originsHelper")}
            </span>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="sigil-excluded-paths">
              {tr("sigils.create.excludedPaths")}
            </Label>
            <Textarea
              id="sigil-excluded-paths"
              value={excludedPathsText}
              placeholder={tr("sigils.create.excludedPathsPlaceholder")}
              onChange={(e) => setExcludedPathsText(e.target.value)}
              rows={3}
            />
            <span className="text-muted-foreground text-xs">
              {tr("sigils.create.excludedPathsHelper")}
            </span>
          </div>
          <div className="flex flex-col gap-2">
            <Label>{tr("sigils.create.kinds")}</Label>
            {SIGIL_KINDS.map((kind) => {
              const { labelKey, feature } = KIND_META[kind];
              const locked = !props.featureEnabled[feature];
              const id = `sigil-kind-${kind}`;
              return (
                <div key={kind} className="flex items-center gap-2 text-sm">
                  <Checkbox
                    id={id}
                    disabled={locked}
                    checked={kinds.includes(kind)}
                    onCheckedChange={(checked) => {
                      setKinds((prev) =>
                        checked === true
                          ? [...prev, kind]
                          : prev.filter((k) => k !== kind),
                      );
                    }}
                  />
                  <Label
                    htmlFor={id}
                    className={
                      locked
                        ? "text-muted-foreground font-normal"
                        : "font-normal"
                    }
                  >
                    {tr(labelKey)}
                  </Label>
                  {locked && (
                    <span className="text-muted-foreground text-xs">
                      {tr("sigils.kind.locked")}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => props.onOpenChange(false)}
            disabled={saving}
          >
            {tr("sigils.dialog.cancel")}
          </Button>
          <Button
            onClick={() => void submit()}
            disabled={saving || !label.trim()}
          >
            {saving
              ? tr(isEdit ? "sigils.dialog.saving" : "sigils.create.creating")
              : tr(isEdit ? "sigils.dialog.save" : "sigils.create.submit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default SigilFormDialog;
