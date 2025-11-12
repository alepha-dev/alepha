import { t } from "@alepha/core";
import { useClient, useRouter, useStore } from "@alepha/react";
import { useForm, useFormState } from "@alepha/react-form";
import { Button, Stack } from "@mantine/core";
import { modals } from "@mantine/modals";
import { IconTag } from "@tabler/icons-react";
import type { ProjectApi } from "../../../api/ProjectApi.ts";
import { currentProjectAtom } from "../../../atoms/currentProjectAtom.ts";
import Control from "../../ui/Control.jsx";

interface RenameZoneModalProps {
  currentZoneName: string;
}

export const RenameZoneModal = (props: RenameZoneModalProps) => {
  const projectApi = useClient<ProjectApi>();
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
