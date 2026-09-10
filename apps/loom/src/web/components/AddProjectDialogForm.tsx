import { Control } from "@alepha/ui/components/control/control";
import { Button } from "@alepha/ui/components/ui/button";
import {
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@alepha/ui/components/ui/dialog";
import { useToast } from "@alepha/ui/components/use-toast/use-toast";
import { useClient } from "alepha/react";
import { useForm, useFormState } from "alepha/react/form";
import { useRouter } from "alepha/react/router";
import { useState } from "react";

import type { LoomController } from "../../api/controllers/LoomController.ts";
import { projectCreateSchema } from "../../api/schemas/projectCreateSchema.ts";
import type { AppRouter } from "../AppRouter.ts";

export interface AddProjectDialogFormProps {
  /**
   * Called once the project is added, or on cancel.
   */
  onDone: () => void;
}

/**
 * The add-project form.
 *
 * It is the server's own `projectCreateSchema`, so the two cannot ask for
 * different things. A refusal (not a repository, already open) is shown in
 * the dialog, under the fields, rather than as a toast that closes over the
 * form the user still has to fix.
 */
export const AddProjectDialogForm = (props: AddProjectDialogFormProps) => {
  const api = useClient<LoomController>();
  const router = useRouter<AppRouter>();
  const toast = useToast();
  const [error, setError] = useState<string>();

  const form = useForm(
    {
      schema: projectCreateSchema,
      handler: async (values) => {
        setError(undefined);
        const project = await api.addProject({ body: values });
        toast.success(`Added ${project.name}`);
        props.onDone();
        await router.push("project", { params: { projectId: project.id } });
      },
      onError: (failure) => setError(failure.message),
    },
    [projectCreateSchema],
  );
  const { loading } = useFormState(form, ["loading"]);

  return (
    <form {...form.props} className="flex flex-col gap-4">
      <DialogHeader>
        <DialogTitle>Add project</DialogTitle>
        <DialogDescription>
          A local git repository. Loom lists its worktrees and reads their
          state; it never writes to the repository.
        </DialogDescription>
      </DialogHeader>

      <Control
        input={form.input.path}
        label="Path"
        description="Any folder inside the repository. ~ is your home."
        placeholder="~/git/alepha"
        text
      />
      <Control
        input={form.input.name}
        label="Name"
        description="Defaults to the repository folder's name."
      />
      <div className="grid grid-cols-2 gap-3">
        <Control
          input={form.input.loreProjectId}
          label="Lore project ID"
          description="Where its #Q numbers live."
        />
        <Control
          input={form.input.loreProjectSlug}
          label="Lore slug"
          description="For links to quests."
        />
      </div>

      {error && (
        <p role="alert" className="text-fail text-sm">
          {error}
        </p>
      )}

      <DialogFooter>
        <Button type="button" variant="ghost" onClick={props.onDone}>
          Cancel
        </Button>
        <Button type="submit" loading={loading}>
          Add project
        </Button>
      </DialogFooter>
    </form>
  );
};
