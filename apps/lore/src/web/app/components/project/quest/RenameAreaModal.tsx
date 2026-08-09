import { Control } from "@alepha/ui/components/control/control";
import { Button } from "@alepha/ui/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@alepha/ui/components/ui/dialog";
import { z } from "alepha";
import { useClient, useStore } from "alepha/react";
import { useForm, useFormState } from "alepha/react/form";
import { useI18n } from "alepha/react/i18n";
import { useRouter } from "alepha/react/router";
import { Tag } from "lucide-react";
import { useEffect, useState } from "react";
import type { ProjectController } from "@/api/controllers/ProjectController.ts";
import { currentProjectAtom } from "@/web/app/atoms/currentProjectAtom.ts";
import type { I18n } from "@/web/app/services/I18n.ts";

const EVENT = "lore:open-rename-area";

export const openRenameAreaModal = (areaName: string) => {
  window.dispatchEvent(new CustomEvent(EVENT, { detail: { areaName } }));
};

export interface RenameAreaFormProps {
  areaName: string;
  onClose: () => void;
}

const RenameAreaForm = (props: RenameAreaFormProps) => {
  const { tr } = useI18n<I18n, "en">();
  const projectApi = useClient<ProjectController>();
  const router = useRouter();
  const [project] = useStore(currentProjectAtom);

  const form = useForm({
    initialValues: { areaName: props.areaName },
    schema: z.object({ areaName: z.string().min(1) }),
    handler: async (data) => {
      if (!project) return;
      await projectApi.renameArea({
        params: { id: project.id },
        body: {
          oldAreaName: props.areaName,
          newAreaName: data.areaName.trim(),
        },
      });
      props.onClose();
      await router.push(router.pathname, { force: true });
    },
  });

  const formState = useFormState(form, ["loading"]);

  return (
    <form {...form.props} className="flex flex-col gap-4">
      <Control
        input={form.input.areaName}
        icon={Tag}
        label={tr("area.rename.name")}
      />
      <div className="flex flex-col gap-2">
        <Button type="submit" disabled={formState.loading}>
          {tr("area.rename.submit")}
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={props.onClose}
          disabled={formState.loading}
        >
          {tr("common.cancel")}
        </Button>
      </div>
    </form>
  );
};

export const RenameAreaModal = () => {
  const { tr } = useI18n<I18n, "en">();
  const [state, setState] = useState<{ open: boolean; areaName: string }>({
    open: false,
    areaName: "",
  });

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as { areaName: string };
      setState({ open: true, areaName: detail.areaName });
    };
    window.addEventListener(EVENT, handler);
    return () => window.removeEventListener(EVENT, handler);
  }, []);

  const close = () => setState({ open: false, areaName: "" });

  return (
    <Dialog open={state.open} onOpenChange={(o) => !o && close()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{tr("area.rename.name")}</DialogTitle>
        </DialogHeader>
        {state.open && (
          <RenameAreaForm areaName={state.areaName} onClose={close} />
        )}
      </DialogContent>
    </Dialog>
  );
};

export default RenameAreaModal;
