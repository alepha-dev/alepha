import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@alepha/ui";
import { Control } from "@alepha/ui/form";
import {
  type I18n,
  MarkdownEditor,
  type MarkdownEditorMode,
  MarkdownModeToggle,
} from "@lore/core/web";
import { useClient, useQuery } from "alepha/react";
import {
  type BaseInputField,
  useActionForm,
  useFormState,
} from "alepha/react/form";
import { useI18n } from "alepha/react/i18n";
import { AtSign, Bot, Cpu, Wrench } from "lucide-react";
import { useState } from "react";

import type { ChatAgentController } from "../../../../api/controllers/ChatAgentController.ts";
import {
  type ChatAgentResource,
  chatAgentBodySchema,
} from "../../../../api/schemas/chatAgentResourceSchema.ts";

export interface ChatAgentDialogProps {
  projectId: number;
  /**
   * The agent to edit; absent creates one.
   */
  agentId?: string;
  /**
   * Every tool name an agent may declare, from the agent list.
   */
  tools: string[];
  onClose: () => void;
  onSaved: () => void;
}

/**
 * Create or edit a chat agent (#E170, #Q4199), in a dialog over the
 * settings list. The forms are built from the create and update actions,
 * so a handle the server refuses lands under the handle field.
 *
 * Editing reads the agent first: the list leaves the pre-prompt out.
 */
const ChatAgentDialog = (props: ChatAgentDialogProps) => {
  const api = useClient<ChatAgentController>();
  const { data: agent } = useQuery(
    {
      key: ["chat-agent", props.projectId, props.agentId],
      enabled: !!props.agentId,
      handler: () =>
        api.getChatAgent({
          params: { projectId: props.projectId, agentId: props.agentId! },
        }),
    },
    [api, props.projectId, props.agentId],
  );

  return (
    <Dialog open onOpenChange={(open) => !open && props.onClose()}>
      {/* A flex column whose body alone scrolls, so the title and the
          footer's Save stay in view however long the playbook (#Q4238). */}
      <DialogContent
        className="flex flex-col overflow-hidden sm:max-w-2xl"
        data-testid="chat-agent-dialog"
      >
        {!props.agentId ? (
          <CreateForm {...props} />
        ) : agent ? (
          <EditForm {...props} agent={agent} />
        ) : null}
      </DialogContent>
    </Dialog>
  );
};

const CreateForm = (props: ChatAgentDialogProps) => {
  const api = useClient<ChatAgentController>();
  const form = useActionForm(api.createChatAgent, {
    id: "chat-agent-create",
    schema: chatAgentBodySchema,
    params: { projectId: props.projectId },
    initialValues: { handle: "", name: "", prePrompt: "", tools: [] },
    onSuccess: () => props.onSaved(),
  });
  return (
    <AgentForm
      form={form}
      input={form.input}
      title={undefined}
      tools={props.tools}
      onClose={props.onClose}
    />
  );
};

const EditForm = (
  props: ChatAgentDialogProps & { agent: ChatAgentResource },
) => {
  const api = useClient<ChatAgentController>();
  const form = useActionForm(api.updateChatAgent, {
    id: "chat-agent-edit",
    schema: chatAgentBodySchema.partial(),
    params: { projectId: props.projectId, agentId: props.agent.id },
    initialValues: {
      handle: props.agent.handle,
      name: props.agent.name,
      prePrompt: props.agent.prePrompt ?? "",
      avatar: props.agent.avatarId ?? null,
      model: props.agent.model ?? null,
      tools: props.agent.tools ?? [],
    },
    onSuccess: () => props.onSaved(),
  });
  return (
    <AgentForm
      form={form}
      input={form.input}
      title={props.agent.handle}
      tools={props.tools}
      onClose={props.onClose}
    />
  );
};

/**
 * The fields both forms share, bound to whichever form holds them.
 */
const AgentForm = (props: {
  form: { submit: () => Promise<unknown> } & Parameters<typeof useFormState>[0];
  input: Record<
    "handle" | "name" | "avatar" | "model" | "tools" | "prePrompt",
    BaseInputField
  >;
  /**
   * Every tool name an agent may declare.
   */
  tools: string[];
  /**
   * The handle being edited, none when creating.
   */
  title: string | undefined;
  onClose: () => void;
}) => {
  const { tr } = useI18n<I18n, "en">();
  const { loading } = useFormState(props.form, ["loading"]);
  return (
    <form
      className="flex min-h-0 flex-1 flex-col gap-4"
      data-testid="chat-agent-form"
      onSubmit={(event) => {
        event.preventDefault();
        void props.form.submit();
      }}
    >
      <DialogHeader>
        <DialogTitle>
          {props.title
            ? tr("chat.agents.form.editTitle", { args: [props.title] })
            : tr("chat.agents.form.createTitle")}
        </DialogTitle>
      </DialogHeader>
      <div
        className="-mx-4 flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4"
        data-testid="chat-agent-form-body"
      >
        <div className="grid gap-4 sm:grid-cols-[96px_1fr]">
          <div data-testid="chat-agent-avatar-field">
            <Control
              input={props.input.avatar}
              label={tr("chat.agents.form.avatar")}
              upload={{
                accept: "image/*",
                maxSize: 2 * 1024 * 1024,
                // `ChatBuckets.AGENT_AVATAR_BUCKET`, a server class the page
                // does not import.
                bucket: "chat-agent-avatars",
                image: { maxWidth: 256 },
              }}
            />
          </div>
          <div className="flex flex-col gap-4">
            <div data-testid="chat-agent-handle">
              <Control
                input={props.input.handle}
                label={tr("chat.agents.form.handle")}
                description={tr("chat.agents.form.handleHint")}
                icon={AtSign}
              />
            </div>
            <div data-testid="chat-agent-name">
              <Control
                input={props.input.name}
                label={tr("chat.agents.form.name")}
                icon={Bot}
              />
            </div>
            <div data-testid="chat-agent-model">
              <Control
                input={props.input.model}
                label={tr("chat.agents.form.model")}
                description={tr("chat.agents.form.modelHint")}
                placeholder={tr("chat.agents.form.modelPlaceholder")}
                icon={Cpu}
              />
            </div>
          </div>
        </div>
        {/* The tools it uses (#Q4430): a multi-select over the assistant's
            own names, empty meaning all of them. */}
        <div data-testid="chat-agent-tools">
          <Control
            input={props.input.tools}
            label={tr("chat.agents.form.tools")}
            description={tr("chat.agents.form.toolsHint")}
            placeholder={tr("chat.agents.form.toolsPlaceholder")}
            countLabel={(count) =>
              tr("chat.agents.toolCount.other", { args: [String(count)] })
            }
            items={props.tools}
            icon={Wrench}
          />
        </div>
        <Control
          input={props.input.prePrompt}
          label={tr("chat.agents.form.prePrompt")}
          description={tr("chat.agents.form.prePromptHint")}
          custom={PrePromptEditor}
        />
      </div>
      <DialogFooter className="mt-0">
        <Button type="button" variant="outlined" onClick={props.onClose}>
          {tr("chat.agents.form.cancel")}
        </Button>
        <Button type="submit" disabled={loading} data-testid="chat-agent-save">
          {tr("chat.agents.form.save")}
        </Button>
      </DialogFooter>
    </form>
  );
};

/**
 * The pre-prompt's Markdown editor, tall enough for a playbook and bounded
 * to half the viewport, with the edit and view toggle in its corner as the
 * release description has it.
 */
const PrePromptEditor = (props: {
  value?: unknown;
  onChange?: (value: unknown) => void;
}) => {
  const [mode, setMode] = useState<MarkdownEditorMode>("edit");
  return (
    <div className="relative" data-testid="chat-agent-preprompt">
      <MarkdownModeToggle
        mode={mode}
        onChange={setMode}
        iconOnly
        className="absolute top-1.5 right-1.5 z-10 border bg-transparent"
      />
      {/* Bounded: a long playbook scrolls here, not the whole dialog. */}
      <div className="max-h-[50dvh] overflow-y-auto rounded-lg">
        <MarkdownEditor
          value={typeof props.value === "string" ? props.value : ""}
          onChange={(next) => props.onChange?.(next)}
          mode={mode}
          lineNumbers={false}
          minHeight={320}
        />
      </div>
    </div>
  );
};

export default ChatAgentDialog;
