import { t } from "alepha";
import { useAlepha, useClient } from "@alepha/react";
import { useForm } from "@alepha/react/form";
import { useI18n } from "@alepha/react/i18n";
import { Card, Flex } from "@mantine/core";
import { IconDeviceFloppy, IconTag } from "@tabler/icons-react";
import type { ProjectApi } from "../../api/ProjectApi.ts";
import { currentProjectAtom } from "../../atoms/currentProjectAtom.ts";
import { userProjectsAtom } from "../../atoms/userProjectsAtom.ts";
import { theme } from "../../constants/theme.ts";
import type { Project } from "../../entities/projects.ts";
import type { I18n } from "../../services/I18n.ts";
import Action from "../ui/Action.jsx";
import Control from "../ui/Control.jsx";

export interface ProjectUpdateProps {
  project: Project;
}

const ProjectUpdate = (props: ProjectUpdateProps) => {
  const projectApi = useClient<ProjectApi>();
  const alepha = useAlepha();
  const { tr } = useI18n<I18n, "en">();

  const form = useForm({
    initialValues: props.project,
    schema: t.object({
      title: t.optional(
        t.string({
          minLength: 3,
          maxLength: 24,
        }),
      ),
      public: t.optional(t.boolean()),
    }),
    handler: async (values) => {
      const project = await projectApi.updateProjectById({
        params: { id: props.project.id },
        body: values,
      });

      alepha.state.set(currentProjectAtom, project);
      alepha.state.set(userProjectsAtom, [
        ...(alepha.state.get(userProjectsAtom) ?? []).filter(
          (p) => p.id !== project.id,
        ),
        project,
      ]);
    },
  });

  return (
    <Card radius={0} withBorder className={"shadow"} bg={theme.colors.card}>
      <Flex component={"form"} {...form.props} direction={"column"} gap={"xl"}>
        <Control
          title={tr("project.create.name")}
          icon={<IconTag />}
          input={form.input.title}
        />
        <Control
          input={form.input.public}
          title={tr("project.create.public")}
          description={tr("project.create.public.helper")}
        />
        <Flex>
          <Action leftSection={<IconDeviceFloppy />} form={form}>
            {tr("project.update.submit")}
          </Action>
        </Flex>
      </Flex>
    </Card>
  );
};

export default ProjectUpdate;
