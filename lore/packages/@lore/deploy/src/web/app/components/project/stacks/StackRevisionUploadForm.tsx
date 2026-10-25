import { Button, useToast } from "@alepha/ui";
import { Control } from "@alepha/ui/form";
import type { I18n } from "@lore/core/web";
import { z } from "alepha";
import { useClient, useQueryClient } from "alepha/react";
import { useForm, useFormState } from "alepha/react/form";
import { useI18n } from "alepha/react/i18n";

import type { StackController } from "../../../../../api/controllers/StackController.ts";

export interface StackRevisionUploadFormProps {
  projectId: number;
  stackId: string;
}

/**
 * Uploads a revision: a compose file, or a tar.gz bundle holding one and the
 * files it references. Refused with every reason when it cannot run on the
 * stack's estates; the toaster at the root says why.
 */
const StackRevisionUploadForm = (props: StackRevisionUploadFormProps) => {
  const { tr } = useI18n<I18n, "en">();
  const toaster = useToast();
  const stackApi = useClient<StackController>();
  const queries = useQueryClient();

  const form = useForm({
    id: `stack-revision-upload-${props.stackId}`,
    schema: z.object({ file: z.file() }),
    handler: async (input) => {
      const revision = await stackApi.uploadStackRevision({
        params: { projectId: props.projectId, stackId: props.stackId },
        body: { file: input.file },
      });
      queries.invalidate(["stacks", props.projectId]);
      queries.invalidate(["stack-revisions", props.projectId, props.stackId]);
      form.reset();
      toaster.success(
        tr("stacks.revision.uploaded", { args: [String(revision.number)] }),
      );
    },
  });
  const { loading } = useFormState(form, ["loading"]);

  return (
    <form
      className="flex items-end gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        void form.submit();
      }}
    >
      <div className="w-64" data-testid="stack-revision-file">
        <Control
          file
          input={form.input.file}
          label={tr("stacks.revision.file")}
        />
      </div>
      <Button
        type="submit"
        variant="outlined"
        disabled={loading}
        data-testid="stack-revision-upload"
      >
        {tr("stacks.revision.upload")}
      </Button>
    </form>
  );
};

export default StackRevisionUploadForm;
