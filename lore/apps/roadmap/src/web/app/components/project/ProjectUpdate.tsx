import { AutoForm } from "@alepha/ui/components/auto-form";
import { Card } from "@alepha/ui/components/ui/card";
import { t } from "alepha";
import { useAlepha, useClient } from "alepha/react";
import { useForm } from "alepha/react/form";
import { useI18n } from "alepha/react/i18n";
import { Tag } from "lucide-react";
import type { ProjectController } from "@/api/controllers/ProjectController.ts";
import type { Project } from "@/api/entities/projects.ts";
import { currentProjectAtom } from "../../atoms/currentProjectAtom.ts";
import { userProjectsAtom } from "../../atoms/userProjectsAtom.ts";
import type { I18n } from "../../services/I18n.ts";

export interface ProjectUpdateProps {
  project: Project;
}

const ProjectUpdate = (props: ProjectUpdateProps) => {
  const projectApi = useClient<ProjectController>();
  const alepha = useAlepha();
  const { tr } = useI18n<I18n, "en">();

  const form = useForm({
    initialValues: props.project,
    schema: t.object({
      title: t.optional(
        t.string({
          title: String(tr("project.create.name")),
          minLength: 3,
          maxLength: 24,
        }),
      ),
      public: t.optional(
        t.boolean({
          title: String(tr("project.create.public")),
          description: String(tr("project.create.public.helper")),
        }),
      ),
    }),
    handler: async (values) => {
      const project = await projectApi.updateProjectById({
        params: { id: props.project.id },
        body: values,
      });

      alepha.store.set(currentProjectAtom, project);
      alepha.store.set(userProjectsAtom, [
        ...(alepha.store.get(userProjectsAtom) ?? []).filter(
          (p) => p.id !== project.id,
        ),
        project,
      ]);
    },
  });

  return (
    <Card className="bg-card p-4 shadow">
      <AutoForm
        form={form}
        fields={{
          title: {
            icon: Tag,
          },
        }}
        submitLabel={String(tr("project.update.submit"))}
      />
    </Card>
  );
};

export default ProjectUpdate;
