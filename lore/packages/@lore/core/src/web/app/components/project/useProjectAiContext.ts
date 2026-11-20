import { useAiContext } from "@alepha/ui/ai";
import { useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";

import { currentProjectAtom } from "../../atoms/currentProjectAtom.ts";

/**
 * Tells an assistant turn which project it is sent from (#Q3208) and, on a
 * page narrower than the project, what that page shows (#Q3972): a quest,
 * an epic, a folio, a use case.
 *
 * Every turn sent while the page is mounted carries `{ projectId,
 * projectSlug, projectTitle, language, contentLanguage }`, and `shown` when
 * the page passes one. `language` is the interface's, the one a reply is
 * written in; `contentLanguage` is the one stored content is written in,
 * the project's `preferredLanguage`, English when unset. The innermost
 * context is the one sent, which is why every page repeats the project.
 *
 * ⚠️ `shown` is what members wrote (titles, steps, descriptions, bodies), so
 * it travels marked `writtenBy: "project members"`, and the assistant's
 * prompt reads it as quoted material, never as instructions. Each text is
 * cut at 1,500 characters, so one long body cannot push the rest
 * past the context block's cap. The context decides what the model is
 * shown, never what a tool may do: every tool runs its own gate.
 */
export const useProjectAiContext = (
  page: string,
  shown?: Record<string, unknown>,
): void => {
  const { lang } = useI18n();
  // Every string cut at 1,500 characters, arrays and objects walked.
  const clip = (value: unknown): unknown => {
    if (typeof value === "string") {
      return value.length > 1500 ? `${value.slice(0, 1500)}...[cut]` : value;
    }
    if (Array.isArray(value)) return value.map((it) => clip(it));
    if (value && typeof value === "object") {
      return Object.fromEntries(
        Object.entries(value).map(([key, it]) => [key, clip(it)]),
      );
    }
    return value;
  };
  const [project] = useStore(currentProjectAtom);
  useAiContext({
    page,
    data: project
      ? {
          projectId: project.id,
          projectSlug: project.slug,
          projectTitle: project.title,
          language: lang,
          contentLanguage: project.preferredLanguage ?? "en",
          ...(shown
            ? {
                shown: {
                  writtenBy: "project members",
                  ...(clip(shown) as Record<string, unknown>),
                },
              }
            : {}),
        }
      : undefined,
  });
};
