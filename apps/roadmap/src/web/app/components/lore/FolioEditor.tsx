import { Control } from "@alepha/ui/components/control/control";
import { ControlSelect } from "@alepha/ui/components/control-select/control-select";
import { Button } from "@alepha/ui/components/ui/button";
import { t } from "alepha";
import { useAlepha, useClient, useStore } from "alepha/react";
import { useForm } from "alepha/react/form";
import { useI18n } from "alepha/react/i18n";
import { useRouter } from "alepha/react/router";
import { ArrowLeft, Save } from "lucide-react";
import type { FolioController } from "@/api/controllers/FolioController.ts";
import type { Folio } from "@/api/entities/folios.ts";
import type { AppRouter } from "../../AppRouter.ts";
import { currentFolioAtom } from "../../atoms/currentFolioAtom.ts";
import { folioTagsAtom } from "../../atoms/folioTagsAtom.ts";
import { userFoliosAtom } from "../../atoms/userFoliosAtom.ts";
import type { I18n } from "../../services/I18n.ts";

interface FolioEditorProps {
  /**
   * `undefined` → create mode. `Folio` → edit mode (initial values pre-filled,
   * save calls `update` instead of `create`).
   */
  folio?: Folio;
}

const folioFormSchema = t.object({
  title: t.string({
    maxLength: 200,
    title: "Title",
  }),
  tags: t.array(t.string(), {
    title: "Tags",
    description:
      "Press Enter or comma to add a tag. Reuse existing ones when you can.",
  }),
  content: t.string({
    title: "Content",
    description: "Markdown is rendered when viewing.",
    default: "",
  }),
});

const FolioEditor = (props: FolioEditorProps) => {
  const { tr } = useI18n<I18n, "en">();
  const router = useRouter<AppRouter>();
  const alepha = useAlepha();
  const folioApi = useClient<FolioController>();
  const [folios, setFolios] = useStore(userFoliosAtom);
  const [tags, setTags] = useStore(folioTagsAtom);

  const isEdit = !!props.folio;

  const form = useForm({
    id: isEdit ? `folio-${props.folio?.id}` : "folio-new",
    schema: folioFormSchema,
    initialValues: {
      title: props.folio?.title ?? "",
      tags: props.folio?.tags ?? [],
      content: props.folio?.content ?? "",
    },
    handler: async (data) => {
      const saved =
        isEdit && props.folio
          ? await folioApi.update({
              params: { id: props.folio.id },
              body: data,
            })
          : await folioApi.create({ body: data });

      // Update sidebar list
      const next = isEdit
        ? folios.map((f) => (f.id === saved.id ? saved : f))
        : [saved, ...folios];
      setFolios(next);

      // Refresh tag list (union of new tags)
      const merged = new Set<string>(tags);
      for (const t of saved.tags) merged.add(t);
      setTags([...merged].sort());

      alepha.store.set(currentFolioAtom, saved);

      await router.push(router.path("loreFolio", { params: { id: saved.id } }));
    },
  });

  const handleBack = async () => {
    if (isEdit && props.folio) {
      await router.push(
        router.path("loreFolio", { params: { id: props.folio.id } }),
      );
    } else {
      await router.push(router.path("lore"));
    }
  };

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4 p-8">
      <div className="flex items-center gap-2">
        <Button
          variant="ghost"
          size="icon"
          onClick={handleBack}
          aria-label={String(tr("lore.back"))}
        >
          <ArrowLeft className="size-4" />
        </Button>
        <h1 className="flex-1 text-xl font-semibold">
          {isEdit ? tr("lore.edit-folio") : tr("lore.new-folio")}
        </h1>
        <Button type="submit" form={form.props.id} disabled={form.submitting}>
          <Save className="size-4" />
          {tr("lore.save")}
        </Button>
      </div>

      <form {...form.props} className="flex flex-col gap-4">
        <Control
          input={form.input.title}
          placeholder={String(tr("lore.title-placeholder"))}
        />
        <ControlSelect
          input={form.input.tags}
          combobox
          createNewEntry
          items={tags.map((tag) => ({ value: tag, label: tag }))}
        />
        <Control
          input={form.input.content}
          area
          placeholder={String(tr("lore.content-placeholder"))}
        />
      </form>
    </div>
  );
};

export default FolioEditor;
