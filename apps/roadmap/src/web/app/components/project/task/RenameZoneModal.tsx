import { useClient, useStore } from "@alepha/react";
import { useForm, useFormState } from "@alepha/react/form";
import { useRouter } from "@alepha/react/router";
import { Button, Stack } from "@mantine/core";
import { modals } from "@mantine/modals";
import { IconTag } from "@tabler/icons-react";
import { t } from "alepha";
import type { ProjectController } from "../../../../../api/controllers/ProjectController.ts";
import { currentProjectAtom } from "../../../atoms/currentProjectAtom.ts";
import Control from "../../ui/Control.tsx";

interface RenameZoneModalProps {
  currentZoneName: string;
}

export const RenameZoneModal = (props: RenameZoneModalProps) => {
  const projectApi = useClient<ProjectController>();
  const router = useRouter();
  const [project] = useStore(currentProjectAtom);

  const form = useForm({
    initialValues: {
      zoneName: props.currentZoneName,
    },
    schema: t.object({
      zoneName: t.string({
        minLength: 1,
      }),
    }),
    handler: async (data) => {
      if (!project) {
        return;
      }

      await projectApi.renameZone({
        params: { id: project.id },
        body: {
          oldZoneName: props.currentZoneName,
          newZoneName: data.zoneName.trim(),
        },
      });

      modals.closeAll();

      await router.go(router.pathname, {
        force: true,
      });
    },
  });

  const formState = useFormState(form, ["loading"]);

  return (
    <form {...form.props}>
      <Stack gap="md">
        <Control
          input={form.input.zoneName}
          text={{
            autoFocus: true,
            placeholder: "Enter new zone name",
          }}
          icon={<IconTag />}
          title="Zone Name"
        />
        <Stack gap="sm">
          <Button type="submit" fullWidth loading={formState.loading}>
            Rename
          </Button>
          <Button
            type="button"
            variant="default"
            onClick={() => modals.closeAll()}
            fullWidth
            disabled={formState.loading}
          >
            Cancel
          </Button>
        </Stack>
      </Stack>
    </form>
  );
};

export const openRenameZoneModal = (zoneName: string) => {
  modals.open({
    title: "Rename Zone",
    children: <RenameZoneModal currentZoneName={zoneName} />,
  });
};
