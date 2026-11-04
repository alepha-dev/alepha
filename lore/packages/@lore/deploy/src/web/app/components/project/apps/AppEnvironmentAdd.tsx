import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  useToast,
} from "@alepha/ui";
import { Control } from "@alepha/ui/form";
import type { I18n } from "@lore/core/web";
import { z } from "alepha";
import { useClient, useQueryClient } from "alepha/react";
import { useForm, useFormState } from "alepha/react/form";
import { useI18n } from "alepha/react/i18n";

import type { AppSecretController } from "../../../../../api/controllers/AppSecretController.ts";
import type { DeclaredEnvKey } from "../../../../../api/schemas/declaredEnvKeySchema.ts";

export interface AppEnvironmentAddProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: number;
  instanceId: string;
  /**
   * Every key the app's build declares, which the name autocompletes from.
   */
  declared: DeclaredEnvKey[];
  /**
   * The names already set, left out of the suggestions: setting one again is
   * what the table's own Edit is for.
   */
  taken: string[];
}

/**
 * Set a variable or a secret, in a dialog opened from the Environment tab's
 * "Add variable" button.
 *
 * The name **autocompletes from what the app declares** (#Q2467), each
 * suggestion carrying its `$env` description and whether it is a secret or a
 * variable, and still accepts any other name: an app can read a key it never
 * declared. Whether the value is stored readable is the server's call, from
 * the declaration, never this form's.
 *
 * ⚠️ The value field is a plain input rather than `type="password"`. Masking
 * the one place a value is legitimately visible - while somebody types it,
 * once - buys nothing and costs the typo they cannot see. The property that
 * matters is that no response ever carries a secret back.
 *
 * The refusals are the server's own words: reserved names, the length bound
 * and the key count come back as messages naming what to do instead, and the
 * root `ActionErrorToaster` shows them as they are (#E59, #Q2329).
 */
const AppEnvironmentAdd = (props: AppEnvironmentAddProps) => {
  const { tr } = useI18n<I18n, "en">();
  const toaster = useToast();
  const secretApi = useClient<AppSecretController>();
  const queries = useQueryClient();

  const taken = new Set(props.taken);
  const suggestions = props.declared
    .filter((declared) => !taken.has(declared.name))
    .map((declared) => ({
      value: declared.name,
      label: declared.name,
      description: declared.description,
      tag: tr(
        declared.kind === "variable"
          ? "app.environment.kind.variable"
          : "app.environment.kind.secret",
      ),
    }));

  const form = useForm({
    id: "app-environment-add",
    schema: z.object({
      key: z.string().min(1).max(100),
      value: z.string().min(1).max(5_000),
    }),
    initialValues: { key: "", value: "" },
    handler: async (input) => {
      await secretApi.setAppSecret({
        params: { projectId: props.projectId, instanceId: props.instanceId },
        body: { key: input.key.trim(), value: input.value },
      });
      queries.invalidate(["app-secrets", props.projectId, props.instanceId]);
      // Cleared on success, and only on success: a refused name is one the
      // operator wants to correct rather than retype.
      form.reset();
      props.onOpenChange(false);
      toaster.success(tr("app.environment.saved"));
    },
  });
  const { loading } = useFormState(form, ["loading"]);

  return (
    <Dialog
      open={props.open}
      onOpenChange={(open) => {
        if (!open) form.reset();
        props.onOpenChange(open);
      }}
    >
      <DialogContent>
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            void form.submit();
          }}
        >
          <DialogHeader>
            <DialogTitle>{tr("app.environment.add")}</DialogTitle>
            <DialogDescription>
              {tr("app.environment.add.description")}
            </DialogDescription>
          </DialogHeader>
          <div data-testid="app-environment-key">
            <Control
              input={form.input.key}
              label={tr("app.environment.key")}
              items={suggestions}
              // Any name, not only a declared one: the suggestions are a
              // shortcut, and an app may read a key it never declared.
              createNewEntry
            />
          </div>
          <div data-testid="app-environment-value">
            <Control
              input={form.input.value}
              label={tr("app.environment.value")}
            />
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outlined"
              onClick={() => props.onOpenChange(false)}
            >
              {tr("app.environment.import.cancel")}
            </Button>
            <Button
              type="submit"
              disabled={loading}
              data-testid="app-environment-save"
            >
              {tr("app.environment.save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};

export default AppEnvironmentAdd;
