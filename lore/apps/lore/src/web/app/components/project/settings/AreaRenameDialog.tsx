import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
} from "@alepha/ui";
import { useAction, useClient } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { useState } from "react";

import type { AreaController } from "@/api/controllers/AreaController.ts";
import type { AreaResource } from "@/api/schemas/areaResourceSchema.ts";
import type { I18n } from "@/web/app/services/I18n.ts";

export interface AreaRenameDialogProps {
  open: boolean;
  area: AreaResource;
  siblings: AreaResource[];
  onClose: () => void;
  onRenamed: (areaId: number) => void;
}

/**
 * Rename with an inline merge preview.
 *
 * As the user types, if the trimmed value exactly (case-sensitive) matches
 * another area's name, the dialog swaps its description and submit label
 * for the merge wording — typing the exact existing name is what triggers
 * `AreaController.renameArea`'s merge branch, so the dialog must say so
 * before the person commits to it.
 */
const AreaRenameDialog = (props: AreaRenameDialogProps) => {
  const { tr } = useI18n<I18n, "en">();
  const areaApi = useClient<AreaController>();
  const [value, setValue] = useState(props.area.name);

  // The dialog stays mounted while closed, so its draft outlived every close:
  // typing a name, cancelling and reopening showed the abandoned draft, and a
  // navigation to another area showed the previous area's name. Re-seed on
  // each open, the way React documents for state that must follow a prop.
  const [wasOpen, setWasOpen] = useState(props.open);
  if (wasOpen !== props.open) {
    setWasOpen(props.open);
    if (props.open) {
      setValue(props.area.name);
    }
  }

  const trimmed = value.trim();
  const collision = props.siblings.find(
    (s) => s.id !== props.area.id && s.name === trimmed,
  );

  const submitAction = useAction<[], void>(
    {
      handler: async () => {
        if (!trimmed || trimmed === props.area.name) {
          props.onClose();
          return;
        }
        const result = await areaApi.renameArea({
          params: { id: props.area.id },
          body: { name: trimmed },
        });
        props.onRenamed(result.areaId);
        props.onClose();
      },
    },
    [areaApi, trimmed, props],
  );
  const submitting = submitAction.loading;
  const submit = submitAction.run;

  return (
    <Dialog open={props.open} onOpenChange={(o) => !o && props.onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{tr("area.detail.rename.title")}</DialogTitle>
          {collision && (
            <DialogDescription>
              {String(
                props.area.questCount === 1
                  ? tr("area.detail.rename.merge.one", {
                      args: [collision.name, props.area.name],
                    })
                  : tr("area.detail.rename.merge", {
                      args: [
                        collision.name,
                        String(props.area.questCount),
                        props.area.name,
                      ],
                    }),
              )}
            </DialogDescription>
          )}
        </DialogHeader>
        <div className="flex flex-col gap-2">
          <Label htmlFor="area-rename-input">
            {tr("area.detail.rename.label")}
          </Label>
          <Input
            id="area-rename-input"
            value={value}
            onChange={(e) => setValue(e.currentTarget.value)}

            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void submit();
              }
            }}
          />
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={props.onClose} disabled={submitting}>
            {tr("common.cancel")}
          </Button>
          <Button
            onClick={() => void submit()}
            disabled={submitting || !areaApi.renameArea.can()}
            variant={collision ? "destructive" : "default"}
          >
            {collision
              ? tr("area.detail.rename.submitMerge")
              : tr("area.detail.rename.submit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default AreaRenameDialog;
