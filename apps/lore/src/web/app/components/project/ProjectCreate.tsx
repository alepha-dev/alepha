import { ControlUpload } from "@alepha/ui/components/control-upload/control-upload";
import { Control } from "@alepha/ui/components/control/control";
import { Button } from "@alepha/ui/components/ui/button";
import { Card, CardContent } from "@alepha/ui/components/ui/card";
import { useToast } from "@alepha/ui/components/use-toast/use-toast";
import { z } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { useAlepha, useClient, useInject } from "alepha/react";
import { useForm, useFormState } from "alepha/react/form";
import { useI18n } from "alepha/react/i18n";
import { useRouter } from "alepha/react/router";
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Hammer,
  LayoutGrid,
  Milestone,
  Tag,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import type { ProjectController } from "@/api/controllers/ProjectController.ts";
import { projectTitleSchema } from "@/api/schemas/projectTitleSchema.ts";

import type { AppRouter } from "../../AppRouter.ts";
import { userProjectsAtom } from "../../atoms/userProjectsAtom.ts";
import type { I18n } from "../../services/I18n.ts";
import PageHeader from "../shared/header/PageHeader.tsx";

const TOTAL_STEPS = 3;
const MIN_BUILD_DURATION_MS = 1500;

type FeaturesDraft = {
  kanban: boolean;
  folios: boolean;
  feedback: boolean;
  milestones: boolean;
};

const DEFAULT_FEATURES: FeaturesDraft = {
  // Folios + Kanban + Milestones opt-in by default. Feedback is no longer a
  // wizard-surfaced module — it's the project's own module switch now,
  // enabled from Settings → Feedback (its own page, split out of the Sigils
  // page). It is not a Sigils sub-capability: an app's own `feedback` kind
  // is a separate, per-app decision made on that app's Settings tab. We
  // still send `feedback: false` here so new projects start with no
  // feedback inbox; we can't move that default into
  // `defaultProjectFeatures` (feedback=true there) without triggering a
  // D1 `projects` table rebuild — see CLAUDE.md "Migration safety on D1".
  folios: true,
  kanban: true,
  milestones: true,
  feedback: false,
};

const ProjectCreate = () => {
  const client = useClient<ProjectController>();
  const toaster = useToast();
  const router = useRouter<AppRouter>();
  const alepha = useAlepha();
  const dateTime = useInject(DateTimeProvider);
  const { tr } = useI18n<I18n, "en">();
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [features, setFeatures] = useState<FeaturesDraft>(DEFAULT_FEATURES);
  // useForm builds its FormModel inside useMemo(..., []) — the handler
  // is created ONCE on first render and closes over `features` from
  // that render. Toggling setFeatures re-renders this component but
  // the form's stored handler still sees DEFAULT_FEATURES. Read via a
  // ref that's always current to dodge the stale closure (alternative:
  // pass deps:[features] to useForm, but that rebuilds the model on
  // every toggle and wipes whatever title/icon the user already typed).
  const featuresRef = useRef(features);
  featuresRef.current = features;

  const initialValues = useMemo(() => {
    try {
      if (router.query.b) {
        return JSON.parse(decodeURIComponent(router.query.b));
      }
    } catch {
      // ignore
    }
  }, [router.query.b]);

  const form = useForm({
    initialValues,
    schema: z.object({
      // The server's own rule, so a title it refuses is refused here first.
      title: projectTitleSchema,
      icon: z.uuid().optional(),
    }),
    onError: (error) => {
      toaster.error(error.message);
      // Back to the last step: the "building" screen has no controls, and a
      // 409 (slug taken) or 403 (project cap) used to strand the user on it.
      setStep(3);
    },
    handler: async (body) => {
      setStep(4);
      const startedAt = dateTime.nowMillis();
      const project = await client.createProject({
        body: { ...body, features: featuresRef.current },
      });
      const elapsed = dateTime.nowMillis() - startedAt;
      if (elapsed < MIN_BUILD_DURATION_MS) {
        await new Promise((r) =>
          setTimeout(r, MIN_BUILD_DURATION_MS - elapsed),
        );
      }

      alepha.store.set(userProjectsAtom, await client.getHomeOverview());

      await router.push("project", {
        params: { projectSlug: project.slug },
        meta: { firstOpen: true },
      });
    },
  });

  const formState = useFormState(form, ["values", "loading"]);
  const submitting = formState.loading;
  const titleValue = String(formState.values?.title ?? "").trim();
  const canAdvanceFromName = titleValue.length >= 3;

  const titleInputId = form.input.title.props.id;
  useEffect(() => {
    if (step !== 1 || !titleInputId) return;
    const el = document.getElementById(titleInputId) as HTMLInputElement | null;
    el?.focus();
  }, [step, titleInputId]);

  const goNext = () =>
    setStep((s) => Math.min(TOTAL_STEPS, s + 1) as 1 | 2 | 3);
  const goBack = () => setStep((s) => Math.max(1, s - 1) as 1 | 2 | 3);

  if (step === 4) {
    return (
      <div className="bg-background flex h-screen w-full flex-col items-center justify-center">
        <PageHeader showHome={false} />
        <BuildingScreen message={tr("project.create.building")} />
      </div>
    );
  }

  return (
    <div className="bg-background flex h-screen w-full flex-col items-center justify-center">
      <PageHeader />
      <div className="mx-auto w-full max-w-xl px-4">
        <StepIndicator current={step} total={TOTAL_STEPS} />
        <Card className="mt-4 shadow-sm">
          <CardContent className="flex flex-col gap-6 pt-2">
            {/* A form-level key handler that stops Enter submitting from a text
                field. The interactive elements are the inputs inside. */}
            {/* oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions */}
            <form
              {...form.props}
              className="flex flex-col gap-6"
              onKeyDown={(e) => {
                if (
                  e.key === "Enter" &&
                  step < TOTAL_STEPS &&
                  !(e.target instanceof HTMLTextAreaElement)
                ) {
                  e.preventDefault();
                  if (step === 1 && !canAdvanceFromName) return;
                  goNext();
                }
              }}
            >
              <div
                key={step}
                className="animate-in fade-in slide-in-from-right-2 flex flex-col gap-5 duration-300"
              >
                {step === 1 && (
                  <StepName
                    title={tr("project.create.step.name")}
                    nameLabel={tr("project.create.name")}
                    nameHelper={tr("project.create.name.helper")}
                    input={form.input.title}
                  />
                )}
                {step === 2 && (
                  <StepLogo
                    title={tr("project.create.step.logo")}
                    helper={tr("project.create.step.logo.helper")}
                    input={form.input.icon}
                    disabled={submitting}
                  />
                )}
                {step === 3 && (
                  <StepModules
                    title={tr("project.create.step.modules")}
                    helper={tr("project.create.step.modules.helper")}
                    value={features}
                    onChange={setFeatures}
                    labels={{
                      folios: tr("project.create.module.folios"),
                      foliosHelper: String(
                        tr("project.create.module.folios.helper"),
                      ),
                      kanban: tr("project.create.module.kanban"),
                      kanbanHelper: String(
                        tr("project.create.module.kanban.helper"),
                      ),
                      milestones: tr("project.create.module.milestones"),
                      milestonesHelper: String(
                        tr("project.create.module.milestones.helper"),
                      ),
                    }}
                  />
                )}
              </div>

              <div className="flex items-center justify-between gap-3">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={goBack}
                  disabled={step === 1 || submitting}
                >
                  <ArrowLeft className="size-4" />
                  {tr("project.create.back")}
                </Button>

                <div className="flex items-center gap-2">
                  {step < TOTAL_STEPS ? (
                    // `key` is critical: React 19 reconciles the ternary by
                    // reusing the same <button> DOM node and just flipping
                    // `type` between renders. When `goNext` advances step
                    // from N-1 to TOTAL_STEPS in the click handler, React's
                    // synchronous flush mutates `type` from "button" to
                    // "submit" mid-click — the browser then dispatches a
                    // real `submit` event on the form (skipping the final
                    // step). Distinct keys force unmount/remount, so the
                    // post-click default action sees the original button
                    // type. See: https://github.com/facebook/react/issues
                    <Button
                      key="next"
                      type="button"
                      size="lg"
                      onClick={goNext}
                      disabled={step === 1 && !canAdvanceFromName}
                      className="h-11 px-6"
                    >
                      {tr("project.create.next")}
                      <ArrowRight className="size-4" />
                    </Button>
                  ) : (
                    <Button
                      key="submit"
                      type="submit"
                      size="lg"
                      disabled={submitting || !canAdvanceFromName}
                      className="h-11 px-6"
                    >
                      <Hammer className="size-4" />
                      {tr("project.create.submit")}
                    </Button>
                  )}
                </div>
              </div>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default ProjectCreate;

interface StepIndicatorProps {
  current: number;
  total: number;
}

const StepIndicator = (props: StepIndicatorProps) => {
  return (
    <div className="flex items-center justify-center gap-1.5">
      {Array.from({ length: props.total }, (_, i) => i + 1).map((n) => (
        <div
          key={n}
          className={`h-1.5 rounded-full transition-all duration-300 ${
            n === props.current
              ? "bg-primary w-8"
              : n < props.current
                ? "bg-primary/60 w-4"
                : "bg-muted w-4"
          }`}
        />
      ))}
    </div>
  );
};

interface StepNameProps {
  title: string;
  nameLabel: string;
  nameHelper: string;
  input: any;
}

const StepName = (props: StepNameProps) => {
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-bold tracking-tight">{props.title}</h1>
      <Control
        input={props.input}
        icon={Tag}
        label={props.nameLabel}
        description={props.nameHelper}
      />
    </div>
  );
};

interface StepLogoProps {
  title: string;
  helper: string;
  input: any;
  disabled: boolean;
}

const StepLogo = (props: StepLogoProps) => {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold tracking-tight">{props.title}</h1>
        <p className="text-muted-foreground text-sm">{props.helper}</p>
      </div>
      {/*
        Bucket value stays "campaign-icons" — see the note on `iconBucket`
        in `ProjectController.ts`.
      */}
      <ControlUpload
        input={props.input}
        accept="image/*"
        maxSize={2 * 1024 * 1024}
        bucket="campaign-icons"
        // Matches `iconBucket`'s server-side `image` constraint. Doing it here
        // as well is not redundant: it is what stops the megabytes leaving the
        // machine, and lossy WebP with alpha is smaller than anything the
        // server's wasm encoder can produce.
        image={{ maxWidth: 256 }}
        disabled={props.disabled}
      />
    </div>
  );
};

interface StepModulesProps {
  title: string;
  helper: string;
  value: FeaturesDraft;
  onChange: (next: FeaturesDraft) => void;
  labels: {
    folios: string;
    foliosHelper: string;
    kanban: string;
    kanbanHelper: string;
    milestones: string;
    milestonesHelper: string;
  };
}

const StepModules = (props: StepModulesProps) => {
  const toggle = (key: keyof FeaturesDraft) =>
    props.onChange({ ...props.value, [key]: !props.value[key] });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold tracking-tight">{props.title}</h1>
        <p className="text-muted-foreground text-sm">{props.helper}</p>
      </div>
      <div className="flex flex-col gap-2">
        <ModuleToggle
          icon={BookOpen}
          label={props.labels.folios}
          helper={props.labels.foliosHelper}
          checked={props.value.folios}
          onChange={() => toggle("folios")}
        />
        <ModuleToggle
          icon={LayoutGrid}
          label={props.labels.kanban}
          helper={props.labels.kanbanHelper}
          checked={props.value.kanban}
          onChange={() => toggle("kanban")}
        />
        <ModuleToggle
          icon={Milestone}
          label={props.labels.milestones}
          helper={props.labels.milestonesHelper}
          checked={props.value.milestones}
          onChange={() => toggle("milestones")}
        />
      </div>
    </div>
  );
};

interface ModuleToggleProps {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  helper: string;
  checked: boolean;
  onChange: () => void;
}

const ModuleToggle = (props: ModuleToggleProps) => {
  const Icon = props.icon;
  return (
    <button
      type="button"
      onClick={props.onChange}
      aria-pressed={props.checked}
      className={`flex items-start gap-3 rounded-lg border p-4 text-left transition-all ${
        props.checked
          ? "border-primary bg-primary/5 ring-primary/30 ring-1"
          : "border-border hover:border-muted-foreground/40 hover:bg-muted/30"
      }`}
    >
      <div
        className={`mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-md ${
          props.checked
            ? "bg-primary/10 text-primary"
            : "bg-muted text-muted-foreground"
        }`}
      >
        <Icon className="size-4" />
      </div>
      <div className="flex flex-1 flex-col gap-0.5">
        <span className="text-sm font-semibold">{props.label}</span>
        <span className="text-muted-foreground text-xs">{props.helper}</span>
      </div>
      <div
        aria-hidden="true"
        className={`mt-0.5 flex h-5 w-9 shrink-0 items-center rounded-full px-0.5 transition-colors ${
          props.checked ? "bg-primary" : "bg-muted"
        }`}
      >
        <span
          className={`bg-background block size-4 rounded-full transition-transform ${
            props.checked ? "translate-x-4" : "translate-x-0"
          }`}
        />
      </div>
    </button>
  );
};

interface BuildingScreenProps {
  message: string;
}

const BuildingScreen = (props: BuildingScreenProps) => {
  return (
    <div className="flex flex-col items-center gap-6">
      <div
        className="text-primary"
        style={{
          animation: "1s ease-in-out infinite hammerSwing",
          transformOrigin: "50% 80%",
        }}
      >
        <Hammer className="size-16" />
      </div>
      <p className="text-muted-foreground text-base font-medium tracking-wide">
        {props.message}
      </p>
    </div>
  );
};
