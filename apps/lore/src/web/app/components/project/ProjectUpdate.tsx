import { AutoForm } from "@alepha/ui/components/auto-form/auto-form";
import { useDialog } from "@alepha/ui/components/use-dialog/use-dialog";
import { useToast } from "@alepha/ui/components/use-toast/use-toast";
import { AlephaError, z } from "alepha";
import { useAlepha, useClient } from "alepha/react";
import { useFieldValue, useForm } from "alepha/react/form";
import { useI18n } from "alepha/react/i18n";
import { useRouter } from "alepha/react/router";
import { HttpError } from "alepha/server";
import { Languages, Tag } from "lucide-react";
import { useMemo } from "react";
import type { ProjectController } from "@/api/controllers/ProjectController.ts";
import type { ProjectResource } from "@/api/schemas/projectResourceSchema.ts";
import { projectTitleSchema } from "@/api/schemas/projectTitleSchema.ts";
import { ProjectSlugService } from "@/api/services/ProjectSlugService.ts";
import type { AppRouter } from "../../AppRouter.ts";
import { currentProjectAtom } from "../../atoms/currentProjectAtom.ts";
import { userProjectsAtom } from "../../atoms/userProjectsAtom.ts";
import type { I18n } from "../../services/I18n.ts";

export interface ProjectUpdateProps {
  project: ProjectResource;
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
  const dialog = useDialog();
  const toaster = useToast();
  const router = useRouter<AppRouter>();
  /**
   * The same class the server derives slugs with, so the preview below cannot
   * drift from what actually gets stored.
   *
   * Constructed rather than injected, and both halves of that are deliberate.
   * `useInject` throws `ContainerLockedError` here — the container is sealed
   * once the app starts, and this service lives in the API graph, which the
   * browser never registers. Declaring it in `LoreWebApp.services` fixes that
   * but pulls an `@/api` import into the web module and perturbs the
   * `SigilSinkProvider` substitution order `main.server.ts` depends on, which
   * takes the whole server down on boot. `ProjectSlugService` is
   * dependency-free by construction (see its own note), so `new` cannot be
   * wrong here in the way it usually would be.
   */
  const slugs = useMemo(() => new ProjectSlugService(), []);

  const form = useForm({
    initialValues: {
      icon: props.project.icon,
      title: props.project.title,
      preferredLanguage: props.project.preferredLanguage ?? NO_LANG,
    },
    schema: z.object({
      icon: z.uuid().nullable().optional(),
      // The shared rule, so the field rejects what the server would reject.
      title: projectTitleSchema.meta({ title: tr("project.create.name") }),
      preferredLanguage: z.string().optional(),
    }),
    handler: async (values) => {
      const currentSlug = props.project.slug;
      const nextSlug = slugs.slugify(values.title) || currentSlug;

      // ⚠️ The confirmation gates the API call from inside the handler, and
      // cancelling puts the old title back — otherwise the field would go on
      // showing a rename that never happened.
      //
      // There is no form-level submit button to hang this on: `AutoForm`'s
      // `autoSave` hides the footer. A *text* field is not auto-committed on
      // keystroke either (see `auto-form.tsx` — string schemas are skipped);
      // it commits via Enter or the inline tick that appears once the field is
      // dirty. So this handler runs on a deliberate gesture, and the dialog is
      // the second one.
      if (nextSlug !== currentSlug) {
        const confirmed = await dialog.confirm({
          title: String(tr("project.update.rename.title")),
          description: String(
            tr("project.update.rename.description", {
              args: [currentSlug, nextSlug],
            }),
          ),
          confirmLabel: String(tr("project.update.rename.confirm")),
          cancelLabel: String(tr("project.update.rename.cancel")),
          destructive: true,
        });

        if (!confirmed) {
          form.input.title.set(props.project.title);
          return;
        }
      }

      const lang = values.preferredLanguage;
      const project = await projectApi
        .updateProjectById({
          params: { id: props.project.id },
          body: {
            title: values.title,
            // Force null so the server can distinguish "cleared" from "absent".
            icon: values.icon ?? null,
            preferredLanguage: lang && lang !== NO_LANG ? lang : null,
          },
        })
        .catch((error: unknown) => {
          // Slugs are unique across the whole instance, so a name can be taken
          // by a project the viewer cannot even see.
          //
          // Toasted, not just re-thrown: `AutoForm` swallows a rejected
          // handler — it logs to the console and renders nothing — so throwing
          // alone left the rename failing in total silence. Caught by the
          // "a name already taken is refused" e2e, which asserted on a message
          // that was never on the page.
          if (HttpError.is(error, 409)) {
            const message = String(tr("project.update.slug.taken"));
            toaster.error(message);
            throw new AlephaError(message);
          }
          throw error;
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

      // The URL this page is sitting on went stale the moment that resolved.
      if (project.slug !== currentSlug) {
        await router.push("projectSettingsBanner", {
          params: { projectSlug: project.slug },
        });
      }
    },
  });

  // Reactive so the URL preview follows what is being typed. Subscribes to
  // this one field, so the rest of the form does not re-render with it.
  const [titleValue] = useFieldValue(form.input.title);
  const previewSlug =
    slugs.slugify(String(titleValue ?? props.project.title)) ||
    props.project.slug;

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
            // Matches the server-side `image` constraint on that bucket.
            image: { maxWidth: 256 },
          },
        },
        title: {
          icon: Tag,
          // The title IS the URL — show what it will become before saving.
          description: String(
            tr("project.update.slug.preview", { args: [previewSlug] }),
          ),
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
