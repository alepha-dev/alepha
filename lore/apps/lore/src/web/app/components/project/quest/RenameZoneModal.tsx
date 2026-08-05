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

const EVENT = "lore:open-rename-zone";

export const openRenameZoneModal = (zoneName: string) => {
  window.dispatchEvent(new CustomEvent(EVENT, { detail: { zoneName } }));
};

export interface RenameZoneFormProps {
  zoneName: string;
  onClose: () => void;
}

const RenameZoneForm = (props: RenameZoneFormProps) => {
  const { tr } = useI18n<I18n, "en">();
  const projectApi = useClient<ProjectController>();
  const router = useRouter();
  const [project] = useStore(currentProjectAtom);

  const form = useForm({
    initialValues: { zoneName: props.zoneName },
    schema: z.object({ zoneName: z.string().min(1) }),
    handler: async (data) => {
      if (!project) return;
      await projectApi.renameZone({
        params: { id: project.id },
        body: {
          oldZoneName: props.zoneName,
          newZoneName: data.zoneName.trim(),
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
        input={form.input.zoneName}
        icon={Tag}
        label={tr("zone.rename.name")}
      />
      <div className="flex flex-col gap-2">
        <Button type="submit" disabled={formState.loading}>
          {tr("zone.rename.submit")}
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

export const RenameZoneModal = () => {
  const { tr } = useI18n<I18n, "en">();
  const [state, setState] = useState<{ open: boolean; zoneName: string }>({
    open: false,
    zoneName: "",
  });

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as { zoneName: string };
      setState({ open: true, zoneName: detail.zoneName });
    };
    window.addEventListener(EVENT, handler);
    return () => window.removeEventListener(EVENT, handler);
  }, []);

  const close = () => setState({ open: false, zoneName: "" });

  return (
    <Dialog open={state.open} onOpenChange={(o) => !o && close()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{tr("zone.rename.name")}</DialogTitle>
        </DialogHeader>
        {state.open && (
          <RenameZoneForm zoneName={state.zoneName} onClose={close} />
        )}
      </DialogContent>
    </Dialog>
  );
};

export default RenameZoneModal;
