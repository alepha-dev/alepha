import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@alepha/ui/components/ui/alert-dialog";
import { Input } from "@alepha/ui/components/ui/input";
import { useI18n } from "alepha/react/i18n";
import { useEffect, useState } from "react";
import type { I18n } from "@/web/app/services/I18n.ts";

export interface CampaignSettingsConfirmationModalProps {
  open: boolean;
  campaign: { title: string };
  onCancel: () => void;
  onConfirm: () => void;
}

const CampaignSettingsConfirmationModal = (
  props: CampaignSettingsConfirmationModalProps,
) => {
  const [inputValue, setInputValue] = useState("");
  const { tr } = useI18n<I18n, "en">();
  const isValid = inputValue === props.campaign.title;

  useEffect(() => {
    if (!props.open) setInputValue("");
  }, [props.open]);

  return (
    <AlertDialog open={props.open} onOpenChange={(o) => !o && props.onCancel()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {tr("campaign.settings.delete.modal.title")}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {tr("campaign.settings.delete.modal.description")}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="flex flex-col gap-3">
          <p className="text-sm">
            {tr("campaign.settings.delete.modal.confirm", {
              args: [props.campaign.title],
            })}
          </p>
          <Input
            value={inputValue}
            onChange={(e) => setInputValue(e.currentTarget.value)}
            placeholder={props.campaign.title}
            autoFocus
          />
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={props.onCancel}>
            {tr("campaign.settings.delete.modal.cancel")}
          </AlertDialogCancel>
          <AlertDialogAction
            disabled={!isValid}
            onClick={(e) => {
              if (!isValid) {
                e.preventDefault();
                return;
              }
              props.onConfirm();
            }}
            className="bg-destructive text-white hover:bg-destructive/90"
          >
            {tr("campaign.settings.delete.modal.submit")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};

export default CampaignSettingsConfirmationModal;
