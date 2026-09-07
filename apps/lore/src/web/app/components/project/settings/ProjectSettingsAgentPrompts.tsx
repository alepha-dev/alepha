import { settingsCardEdge } from "@alepha/ui/components/settings/settings-card-edge.ts";
import { Card, CardContent } from "@alepha/ui/components/ui/card";
import { cn } from "@alepha/ui/lib/utils";
import { useAlepha, useClient, useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { useEffect, useState } from "react";

import type { ProjectPromptController } from "@/api/controllers/ProjectPromptController.ts";
import type { AgentPromptKind } from "@/api/schemas/agentPromptKindSchema.ts";
import { currentProjectAtom } from "@/web/app/atoms/currentProjectAtom.ts";
import { projectPromptsAtom } from "@/web/app/atoms/projectPromptsAtom.ts";
import type { I18n } from "@/web/app/services/I18n.ts";
import { capabilityOption } from "@/web/app/services/projectCapabilities.ts";

import { ProjectSettingsAgentPromptEditor } from "./ProjectSettingsAgentPromptEditor.tsx";

/**
 * The order the surfaces appear in, which is the order the editors do.
 */
const KINDS: AgentPromptKind[] = [
  "epicReview",
  "epicActivate",
  "questWork",
  "feedbackWork",
];

/**
 * The seven placeholders, in the order the legend lists them.
 *
 * ⚠️ `project` and `slug` are two entries because they are two values, and
 * the legend has to say which is which: `project_name` over MCP matches the
 * project's TITLE lowercased and never its slug, so a prompt that passes the
 * slug resolves nothing on any project whose two differ.
 */
const PLACEHOLDERS = [
  "project",
  "slug",
  "number",
  "id",
  "reference",
  "title",
  "url",
] as const;

/**
 * Where the owner writes the four agent prompt templates.
 *
 * ⚠️ **This does not render the switch.** `ProjectSettingsCapabilitySection`
 * generates one row per registry option, so `agentPrompts` gets its switch,
 * its label and its accessible name from the registry entry. What lives here
 * is the editors and the legend behind it.
 *
 * ⚠️ **It fetches the stored rows unconditionally whenever it renders with
 * the option on**, and that is not only to seed the editors. The route
 * loader writes `{}` into `projectPromptsAtom` both when the option is off
 * and when the option is on with nothing customised, so the atom cannot say
 * whether it was ever filled. Flipping the switch does not re-run the
 * loader, so without this an owner who turns the option on and copies a
 * prompt from Epics gets the built-in defaults over their own stored
 * templates, silently, until the next project navigation. Settings is the
 * only surface the switch can be flipped from, so fetching here closes it
 * everywhere.
 */
const ProjectSettingsAgentPrompts = () => {
  const { tr } = useI18n<I18n, "en">();
  const alepha = useAlepha();
  const promptApi = useClient<ProjectPromptController>();
  const [project] = useStore(currentProjectAtom);
  const [prompts, setPrompts] = useStore(projectPromptsAtom);
  const [loaded, setLoaded] = useState(false);

  // ⚠️ Read off `currentProjectAtom` and NOT through `useCapabilityOption`.
  // That hook is a write handle: it returns `{ enabled, toggle }` and holds
  // optimistic pending state for a switch this section does not own.
  const enabled = capabilityOption(project, "work", "agentPrompts");
  const projectId = project?.id;

  useEffect(() => {
    if (!enabled || projectId === undefined) return;
    let cancelled = false;
    promptApi
      .getProjectPrompts({ params: { projectId } })
      .then((rows) => {
        if (cancelled) return;
        alepha.store.set(
          projectPromptsAtom,
          Object.fromEntries(rows.map((it) => [it.kind, it.template])),
        );
        setLoaded(true);
      })
      // A failed read leaves the editors on the built-in defaults, which is
      // what an owner who has customised nothing would see anyway. Better
      // than an error state on a page whose other sections work.
      .catch(() => setLoaded(true));
    return () => {
      cancelled = true;
    };
  }, [alepha, enabled, projectId, promptApi]);

  if (!project || !enabled) return null;

  const save = async (kind: AgentPromptKind, template: string) => {
    await promptApi.setProjectPrompt({
      params: { projectId: project.id, kind },
      body: { template },
    });
    // Written back so the next copy uses the new text without a reload.
    setPrompts({ ...prompts, [kind]: template });
  };

  const reset = async (kind: AgentPromptKind) => {
    await promptApi.resetProjectPrompt({
      params: { projectId: project.id, kind },
    });
    const next = { ...prompts };
    // Deleted rather than set to the default: absence is what "follows the
    // default" means, here as in the table.
    delete next[kind];
    setPrompts(next);
  };

  return (
    <Card className={cn(settingsCardEdge, "py-4")}>
      <CardContent className="flex flex-col gap-4 px-4">
        <div className="flex flex-col gap-1">
          <span className="text-sm font-medium">
            {tr("agentPrompts.settings.title")}
          </span>
          <span className="text-muted-foreground text-xs">
            {tr("agentPrompts.settings.description")}
          </span>
        </div>

        <div className="bg-muted/30 flex flex-col gap-1 rounded-md p-3">
          <span className="text-xs font-medium">
            {tr("agentPrompts.settings.legend")}
          </span>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
            {PLACEHOLDERS.map((name) => (
              <div key={name} className="contents">
                <dt className="text-muted-foreground font-mono text-xs">
                  {`{{${name}}}`}
                </dt>
                <dd className="text-muted-foreground text-xs">
                  {tr(`agentPrompts.settings.placeholder.${name}` as never)}
                </dd>
              </div>
            ))}
          </dl>
        </div>

        {/* Rendered only once the fetch has answered, so an editor is never
            seeded with the default and then jumped to the stored template
            under the reader's cursor. */}
        {loaded &&
          KINDS.map((kind) => (
            <ProjectSettingsAgentPromptEditor
              key={kind}
              kind={kind}
              stored={prompts?.[kind]}
              onSave={save}
              onReset={reset}
            />
          ))}
      </CardContent>
    </Card>
  );
};

export default ProjectSettingsAgentPrompts;
