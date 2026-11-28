import { Button } from "@alepha/ui";
import { Control } from "@alepha/ui/form";
import { currentProjectAtom, type I18n } from "@lore/core/web";
import { z } from "alepha";
import { useClient, useStore } from "alepha/react";
import { useForm, useFormState } from "alepha/react/form";
import { useI18n } from "alepha/react/i18n";
import { useRouter } from "alepha/react/router";
import type { ReactElement } from "react";

import type { FolioController } from "../../../../../../api/controllers/FolioController.ts";
import { userFoliosAtom } from "../../../../atoms/userFoliosAtom.ts";

export interface FolioTableCreateProps {
  directoryId?: string;
  /**
   * `table` (the default) or `calendar` (#Q3717).
   */
  type?: "table" | "calendar";
}

/**
 * Create a table folio from `/folios/new?type=table` (#E144), or a calendar
 * from `?type=calendar` (#Q3717): a title, then the folio opens on its grid
 * with one text column, Name, or on its month with Title and Date. Neither
 * has a draft to type into first, so it is created on submit.
 */
const FolioTableCreate = (props: FolioTableCreateProps): ReactElement => {
  const { tr } = useI18n<I18n, "en">();
  const [project] = useStore(currentProjectAtom);
  const [folios, setFolios] = useStore(userFoliosAtom);
  const folioApi = useClient<FolioController>();
  const router = useRouter();
  const calendar = props.type === "calendar";

  const form = useForm({
    schema: z.object({ title: z.string().min(1).max(200) }),
    initialValues: {
      title: calendar
        ? tr("folios.editor.tree.untitled-calendar")
        : tr("folios.editor.tree.untitled-table"),
    },
    handler: async (values) => {
      if (!project) return;
      const created = await folioApi.create({
        body: {
          projectId: project.id,
          title: values.title.trim(),
          type: calendar ? "calendar" : "table",
          ...(props.directoryId ? { directoryId: props.directoryId } : {}),
        },
      });
      setFolios([created, ...folios]);
      await router.push(
        router.path("projectFoliosFolio", {
          params: { projectSlug: project.slug, shortId: created.shortId },
        }),
      );
    },
  });
  const { loading } = useFormState(form, ["loading"]);

  return (
    <form
      {...form.props}
      className="mx-auto flex w-full max-w-md flex-col gap-4 px-8 py-16"
    >
      <h1 className="text-lg font-semibold">
        {calendar
          ? tr("folios.calendar.create.title")
          : tr("folios.table.create.title")}
      </h1>
      <Control
        input={form.input.title}
        label={tr("folios.title-placeholder")}
      />
      <Button type="submit" loading={loading}>
        {calendar
          ? tr("folios.calendar.create.submit")
          : tr("folios.table.create.submit")}
      </Button>
    </form>
  );
};

export default FolioTableCreate;
