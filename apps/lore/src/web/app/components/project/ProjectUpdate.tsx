import { AutoForm } from "@alepha/ui/components/auto-form/auto-form";
import { z } from "alepha";
import { useAlepha, useClient } from "alepha/react";
import { useForm } from "alepha/react/form";
import { useI18n } from "alepha/react/i18n";
import { Languages, Tag } from "lucide-react";
import type { ProjectController } from "@/api/controllers/ProjectController.ts";
import type { Project } from "@/api/entities/projects.ts";
import { currentProjectAtom } from "../../atoms/currentProjectAtom.ts";
import { userProjectsAtom } from "../../atoms/userProjectsAtom.ts";
import type { I18n } from "../../services/I18n.ts";

export interface ProjectUpdateProps {
  project: Project;
}

/**
 * Sentinel for the "No preference" language option: the form handler maps
 * it back to `null` before hitting the API.
 *
 * The original comment here justified it by a Radix constraint. There is no
 * Radix in this codebase — `Select` is `@base-ui/react/select` — so that
 * reason was not the real one. The sentinel is kept because a select option
 * still needs a non-null `value` to be addressable, and `""` reads as "unset"
 * rather than as a deliberate choice.
 */
const NO_LANG = "__none__";

/**
 * Top-10 most-spoken languages, ISO 639-1. Labels show the native
 * script alongside the English name so the dropdown is recognisable
 * regardless of which UI language the viewer has on.
 */
const LANGUAGE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: NO_LANG, label: "—" },
  { value: "en", label: "English" },
  { value: "zh", label: "中文 · Chinese" },
  { value: "es", label: "Español · Spanish" },
  { value: "hi", label: "हिन्दी · Hindi" },
  { value: "fr", label: "Français · French" },
  { value: "ar", label: "العربية · Arabic" },
  { value: "pt", label: "Português · Portuguese" },
  { value: "de", label: "Deutsch · German" },
  { value: "ja", label: "日本語 · Japanese" },
  { value: "ru", label: "Русский · Russian" },
];

const ProjectUpdate = (props: ProjectUpdateProps) => {
  const projectApi = useClient<ProjectController>();
  const alepha = useAlepha();
  const { tr } = useI18n<I18n, "en">();

  const form = useForm({
    initialValues: {
      icon: props.project.icon,
      title: props.project.title,
      preferredLanguage: props.project.preferredLanguage ?? NO_LANG,
    },
    schema: z.object({
      icon: z.uuid().nullable().optional(),
      title: z
        .string()
        .min(3)
        .max(24)
        .meta({ title: tr("project.create.name") }),
      preferredLanguage: z.string().optional(),
    }),
    handler: async (values) => {
      const lang = values.preferredLanguage;
      const project = await projectApi.updateProjectById({
        params: { id: props.project.id },
        body: {
          title: values.title,
          // Force null so the server can distinguish "cleared" from "absent".
          icon: values.icon ?? null,
          preferredLanguage: lang && lang !== NO_LANG ? lang : null,
        },
      });

      alepha.store.set(currentProjectAtom, project);
      const overview = alepha.store.get(userProjectsAtom);
      if (overview) {
        alepha.store.set(userProjectsAtom, {
          ...overview,
          projects: overview.projects.map((p) =>
            p.id === project.id ? project : p,
          ),
        });
      }
    },
  });

  return (
    <AutoForm
      form={form}
      layout="row"
      autoSave
      groups={[{ fields: ["icon", "title", "preferredLanguage"] }]}
      fields={{
        icon: {
          label: "Icon",
          upload: {
            accept: "image/*",
            maxSize: 2 * 1024 * 1024,
            // Bucket value stays "campaign-icons" — see the note on
            // `iconBucket` in `ProjectController.ts`.
            bucket: "campaign-icons",
          },
        },
        title: {
          icon: Tag,
        },
        preferredLanguage: {
          label: tr("project.update.preferredLanguage.label"),
          icon: Languages,
          select: true,
          items: LANGUAGE_OPTIONS,
          description: tr("project.update.preferredLanguage.helper"),
        },
      }}
    />
  );
};

export default ProjectUpdate;
