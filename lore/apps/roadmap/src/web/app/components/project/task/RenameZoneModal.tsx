import { ActionButton, Flex } from "@alepha/ui";
import { modals } from "@mantine/modals";
import { IconTag } from "@tabler/icons-react";
import { t } from "alepha";
import { useClient, useStore } from "alepha/react";
import { useForm, useFormState } from "alepha/react/form";
import { useI18n } from "alepha/react/i18n";
import { useRouter } from "alepha/react/router";
import type { ProjectController } from "../../../../../api/controllers/ProjectController.ts";
import { currentProjectAtom } from "../../../atoms/currentProjectAtom.ts";
import type { I18n } from "../../../services/I18n.ts";
import Control from "../../ui/Control.tsx";

interface RenameZoneModalProps {
  currentZoneName: string;
}

export const RenameZoneModal = (props: RenameZoneModalProps) => {
  const { tr } = useI18n<I18n, "en">();
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

      await router.push(router.pathname, {
        force: true,
      });
    },
  });

  const formState = useFormState(form, ["loading"]);

  return (
    <form {...form.props}>
      <Flex direction="column" gap="md">
        <Control
          input={form.input.zoneName}
          text={{
            autoFocus: true,
            placeholder: tr("zone.rename.placeholder"),
          }}
          icon={<IconTag />}
          title={tr("zone.rename.name")}
        />
        <Flex direction="column" gap="sm">
          <ActionButton type="submit" fullWidth loading={formState.loading}>
            {tr("zone.rename.submit")}
          </ActionButton>
          <ActionButton
            variant="default"
            onClick={() => modals.closeAll()}
            fullWidth
            disabled={formState.loading}
          >
            {tr("common.cancel")}
          </ActionButton>
        </Flex>
      </Flex>
    </form>
  );
};

export const openRenameZoneModal = (zoneName: string) => {
  modals.open({
    title: "Rename Zone", // Modal is opened outside React context, can't use tr() here
    children: <RenameZoneModal currentZoneName={zoneName} />,
  });
};
