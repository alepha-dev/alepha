import { AutoForm } from "@alepha/ui/components/auto-form/auto-form";
import { useDialog } from "@alepha/ui/components/use-dialog/use-dialog";
import { useToast } from "@alepha/ui/components/use-toast/use-toast";
import { AlephaError, z } from "alepha";
import { useAlepha, useClient } from "alepha/react";
import { useForm } from "alepha/react/form";
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
   * The same class the server derives slugs with, so the handler's "did this
   * edit move the URL?" test cannot disagree with what the server will
   * actually store, and the confirmation fires exactly when it should.
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
      // Inside the handler rather than on the Save button, because only some
      // edits move the slug: changing the icon or the preferred language
      // leaves the URL alone, and the button cannot know which edit this was.
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
          // Toasted, not just re-thrown. A throw now also reaches the action
          // row's error popover, but that is an icon the user has to click;
          // while this form ran on `autoSave` there was no action row at all
          // and a throw reached nothing, so the rename failed in total
          // silence. Caught by the "a name already taken is refused" e2e,
          // which asserted on a message that was never on the page.
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
          // `updateProjectById`'s response has neither `areaCount` nor
          // `openQuestCount` — only `getHomeOverview` computes those — so
          // carry the existing ones forward rather than dropping them to 0.
          projects: overview.projects.map((p) =>
            p.id === project.id
              ? {
                  ...project,
                  areaCount: p.areaCount,
                  openQuestCount: p.openQuestCount,
                }
              : p,
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

  return (
    <AutoForm
      form={form}
      layout="row"
      disabledIfPristine
      // Only Name is required, and a project without one is not a thing you
      // could have meant. The asterisk singles out the field nobody was going
      // to leave empty, which is the opposite of what it is for.
      requiredMarker={false}
      groups={[
        {
          // The card's own heading. It used to be a hand-rolled `<span
          // className="text-sm">` in `ProjectSettingsGeneralPage` because
          // `AutoFormGroup` had no way to carry one — the exact drift
          // `SettingsHeading` exists to prevent, which the group now renders.
          title: String(tr("project.settings.general.title")),
          fields: ["icon", "title", "preferredLanguage"],
        },
      ]}
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
