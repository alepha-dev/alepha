import { Alert, AlertDescription, AlertTitle, Button } from "@alepha/ui";
import { DateTimeProvider } from "alepha/datetime";
import { useAction, useClient, useInject } from "alepha/react";
import { useAuth } from "alepha/react/auth";
import { useI18n } from "alepha/react/i18n";
import { useRouter } from "alepha/react/router";
import { ShieldAlert, UserPlus } from "lucide-react";
import { useEffect, useState } from "react";

import type { ProjectJoinController } from "../../../../api/controllers/ProjectJoinController.ts";
import type { OpenProjectCard } from "../../../../api/schemas/openProjectCardSchema.ts";
import type { I18n } from "../../services/I18n.ts";
import { ProjectJoinIntent } from "../../services/ProjectJoinIntent.ts";
import { ProjectIcon } from "../shared/ProjectIcon.tsx";

export interface ProjectJoinPageProps {
  /**
   * The open project's public card, from `previewOpenProject`: no member
   * count, nothing behind the link.
   */
  card: OpenProjectCard;
  /**
   * Why a join started before sign-in was refused on return, in the
   * server's own sentence (an admin removed the visitor, the project is
   * full, too many joins).
   */
  refusal?: string;
}

/**
 * What a non-member sees on an open project's URL, signed in or not: the
 * project card and a **Join project** button.
 *
 * Signed out, the button records a join intent and sends the visitor to sign
 * in with this URL as the way back; back on this page, signed in, the intent
 * completes the join (see {@link ProjectJoinIntent}). Signed in, the button
 * joins at once. Either way the URL then reloads and opens as a member on
 * Viewer.
 */
const ProjectJoinPage = (props: ProjectJoinPageProps) => {
  const { tr } = useI18n<I18n, "en">();
  const router = useRouter();
  const auth = useAuth();
  const time = useInject(DateTimeProvider);
  const joinApi = useClient<ProjectJoinController>();
  const [refusal, setRefusal] = useState(props.refusal);

  const here = (): `/${string}` =>
    typeof window === "undefined"
      ? `/${props.card.slug}`
      : `/${(window.location.pathname + window.location.search).replace(/^\/+/, "")}`;

  const join = useAction<[], void>(
    {
      handler: async () => {
        if (!auth.user) {
          ProjectJoinIntent.remember(props.card.slug, time.nowMillis());
          await router.push(
            `/auth/login?redirect=${encodeURIComponent(here())}`,
          );
          return;
        }
        try {
          await joinApi.joinProject({ params: { id: props.card.id } });
        } catch (error) {
          setRefusal(
            error instanceof Error ? error.message : tr("project.join.refused"),
          );
          return;
        }
        await router.push(here(), { force: true });
      },
    },
    [auth.user, joinApi, props.card, router, time, tr],
  );

  // A join this visitor started before signing in completes here, once, on
  // their return: the project route sends them back to this page, and only
  // the browser can read the intent. No intent, no join.
  useEffect(() => {
    if (!auth.user || props.refusal) return;
    if (!ProjectJoinIntent.take(props.card.slug, time.nowMillis())) return;
    void join.run();
  }, []);

  return (
    <div
      className="flex h-svh max-h-full flex-1 items-center justify-center p-8"
      data-testid="project-join-page"
    >
      <div className="flex w-full max-w-sm flex-col items-center gap-4 text-center">
        <ProjectIcon
          fileId={props.card.icon}
          title={props.card.title}
          seed={props.card.slug}
          className="size-16 rounded-xl"
        />
        <h1 className="text-xl font-semibold">{props.card.title}</h1>
        <p className="text-muted-foreground text-sm">
          {tr("project.join.lead")}
        </p>
        <p className="text-muted-foreground text-sm">
          {tr("project.join.reads")}
        </p>
        {refusal ? (
          <Alert data-testid="project-join-refusal" className="text-left">
            <ShieldAlert />
            <AlertTitle>{tr("project.join.refused")}</AlertTitle>
            <AlertDescription>{refusal}</AlertDescription>
          </Alert>
        ) : (
          <Button disabled={join.loading} onClick={() => void join.run()}>
            <UserPlus className="size-4" />
            {auth.user ? tr("project.join.submit") : tr("project.join.signIn")}
          </Button>
        )}
      </div>
    </div>
  );
};

export default ProjectJoinPage;
