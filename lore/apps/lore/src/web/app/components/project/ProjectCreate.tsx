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
  AppWindow,
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Hammer,
  Inbox,
  Swords,
  Tag,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import type { ProjectController } from "@/api/controllers/ProjectController.ts";
import type { CapabilityKey } from "@/api/schemas/capabilityKeySchema.ts";
import { projectTitleSchema } from "@/api/schemas/projectTitleSchema.ts";
import type {
  CapabilityDescriptor,
  CapabilityOptionDescriptor,
} from "@/api/services/CapabilityRegistry.ts";

import type { AppRouter } from "../../AppRouter.ts";
import { userProjectsAtom } from "../../atoms/userProjectsAtom.ts";
import { capabilityRegistry as registry } from "../../services/capabilityRegistry.ts";
import type { I18n } from "../../services/I18n.ts";
import PageHeader from "../shared/header/PageHeader.tsx";

const MIN_BUILD_DURATION_MS = 1500;

/**
 * The icon for each capability's row in the pick step.
 *
 * Web-side because an icon is a React element and the registry has to stay
 * importable by the server. Keyed by the same enum, so a fifth capability is
 * one entry here and one declaration there.
 */
const CAPABILITY_ICONS: Record<
  CapabilityKey,
  React.ComponentType<{ className?: string }>
> = {
  work: Swords,
  knowledge: BookOpen,
  apps: AppWindow,
  support: Inbox,
};

/**
 * What the wizard has collected: which capabilities, and the options inside
 * each.
 *
 * Options are kept for every capability, enabled or not, so unchecking one and
 * changing your mind does not silently reset what you had already set up.
 * Only the enabled ones are sent.
 */
interface CapabilityDraft {
  enabled: CapabilityKey[];
  options: Record<string, Record<string, boolean>>;
}

const ProjectCreate = () => {
  const client = useClient<ProjectController>();
  const toaster = useToast();
  const router = useRouter<AppRouter>();
  const alepha = useAlepha();
  const dateTime = useInject(DateTimeProvider);
  const { tr } = useI18n<I18n, "en">();
  const [step, setStep] = useState<number>(1);
  const [draft, setDraft] = useState<CapabilityDraft>(() => ({
    enabled: registry
      .all()
      .filter((it) => it.preselectedCapability)
      .map((it) => it.key),
    options: Object.fromEntries(
      registry
        .all()
        .map((it) => [it.key, registry.preselectedOptionsOf(it.key)]),
    ),
  }));
  // useForm builds its FormModel inside useMemo(..., []) — the handler is
  // created ONCE on first render and closes over `draft` from that render.
  // Toggling a capability re-renders this component but the form's stored
  // handler still sees the initial draft. Read via a ref that is always
  // current to dodge the stale closure (the alternative, `deps: [draft]`,
  // rebuilds the model on every toggle and wipes whatever title was typed).
  const draftRef = useRef(draft);
  draftRef.current = draft;

  /**
   * Which capabilities have something to ask on the setup step.
   *
   * ⚠️ **This is what makes `TOTAL_STEPS` stop being a constant.** A
   * Knowledge-only or Support-only project has nothing to set up, so the
   * wizard is two steps instead of three - and a variable step count is
   * exactly the condition that fires the React 19 button hazard below.
   */
  const setupSections = draft.enabled.filter(
    (key) => registry.wizardOptionsOf(key).length > 0,
  );
  const hasSetup = setupSections.length > 0;
  const totalSteps = hasSetup ? 3 : 2;
  const forgingStep = totalSteps + 1;

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
    }),
    onError: (error) => {
      toaster.error(error.message);
      // Back to the last step with controls on it: the "building" screen has
      // none, and a 409 (slug taken) or 403 (project cap) used to strand the
      // user on it. Read from the ref rather than `totalSteps`, which is
      // captured by the form model on first render.
      setStep(
        draftRef.current.enabled.some(
          (key) => registry.wizardOptionsOf(key).length > 0,
        )
          ? 3
          : 2,
      );
    },
    handler: async (body) => {
      // The forging screen. Computed rather than the literal 4, because the
      // wizard is two steps for a project with nothing to set up.
      setStep(
        draftRef.current.enabled.some(
          (key) => registry.wizardOptionsOf(key).length > 0,
        )
          ? 4
          : 3,
      );
      const startedAt = dateTime.nowMillis();
      const project = await client.createProject({
        body: {
          ...body,
          // Only the enabled ones. A row exists only for an enabled
          // capability, and the options of the others are kept in the draft
          // purely so unchecking one and changing your mind does not reset
          // what you had set up.
          capabilities: draftRef.current.enabled.map((key) => ({
            key,
            options: draftRef.current.options[key] ?? {},
          })),
        },
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

  /**
   * The step actually on screen.
   *
   * ⚠️ Clamped during render rather than corrected in an effect. Unchecking
   * the last capability with options while standing on step 3 leaves `step`
   * pointing at a step that no longer exists, and the obvious fix - a
   * `useEffect` calling `setStep` - is a cascading render that paints the
   * missing step for one frame first. Deriving it costs nothing and cannot
   * flash.
   */
  const activeStep = step === forgingStep ? step : Math.min(step, totalSteps);

  const titleInputId = form.input.title.props.id;
  useEffect(() => {
    if (activeStep !== 1 || !titleInputId) return;
    const el = document.getElementById(titleInputId) as HTMLInputElement | null;
    el?.focus();
  }, [activeStep, titleInputId]);

  const goNext = () => setStep(Math.min(totalSteps, activeStep + 1));
  const goBack = () => setStep(Math.max(1, activeStep - 1));

  const toggleCapability = (key: CapabilityKey) =>
    setDraft((current) => ({
      ...current,
      enabled: current.enabled.includes(key)
        ? current.enabled.filter((it) => it !== key)
        : [...current.enabled, key],
    }));

  const toggleOption = (key: CapabilityKey, option: string) =>
    setDraft((current) => ({
      ...current,
      options: {
        ...current.options,
        [key]: {
          ...current.options[key],
          [option]: !current.options[key]?.[option],
        },
      },
    }));

  if (activeStep === forgingStep) {
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
        <StepIndicator current={activeStep} total={totalSteps} />
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
                  activeStep < totalSteps &&
                  !(e.target instanceof HTMLTextAreaElement)
                ) {
                  e.preventDefault();
                  if (activeStep === 1 && !canAdvanceFromName) return;
                  goNext();
                }
              }}
            >
              <div
                key={activeStep}
                className="animate-in fade-in slide-in-from-right-2 flex flex-col gap-5 duration-300"
              >
                {activeStep === 1 && (
                  <StepName
                    title={tr("project.create.step.name")}
                    nameLabel={tr("project.create.name")}
                    nameHelper={tr("project.create.name.helper")}
                    input={form.input.title}
                  />
                )}
                {activeStep === 2 && (
                  <StepCapabilities
                    title={String(tr("project.create.step.capabilities"))}
                    helper={String(
                      tr("project.create.step.capabilities.helper"),
                    )}
                    capabilities={registry.all()}
                    enabled={draft.enabled}
                    onToggle={toggleCapability}
                    tr={tr}
                  />
                )}
                {activeStep === 3 && hasSetup && (
                  <StepSetup
                    title={String(tr("project.create.step.setup"))}
                    helper={String(tr("project.create.step.setup.helper"))}
                    sections={setupSections.map((key) => ({
                      key,
                      capability: registry.get(key),
                      options: registry.wizardOptionsOf(key),
                    }))}
                    values={draft.options}
                    onToggle={toggleOption}
                    soonLabel={String(tr("project.create.soon"))}
                    tr={tr}
                  />
                )}
              </div>

              <div className="flex items-center justify-between gap-3">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={goBack}
                  disabled={activeStep === 1 || submitting}
                >
                  <ArrowLeft className="size-4" />
                  {tr("project.create.back")}
                </Button>

                <div className="flex items-center gap-2">
                  {activeStep < totalSteps ? (
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
                      disabled={
                        (activeStep === 1 && !canAdvanceFromName) ||
                        (activeStep === 2 && draft.enabled.length === 0)
                      }
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
                      disabled={
                        submitting ||
                        !canAdvanceFromName ||
                        draft.enabled.length === 0
                      }
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

interface StepCapabilitiesProps {
  title: string;
  helper: string;
  capabilities: CapabilityDescriptor[];
  enabled: CapabilityKey[];
  onToggle: (key: CapabilityKey) => void;
  tr: (key: never) => string | number;
}

/**
 * "What is this project?" - the question the old step 3 never asked.
 *
 * It offered Folios, Kanban and Releases: one product, one *view* of quests,
 * and one *grouping* of quests, with nothing on screen saying what Lore is
 * for. These four are the surfaces, and the reader picks the ones they came
 * for.
 */
const StepCapabilities = (props: StepCapabilitiesProps) => {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold tracking-tight">{props.title}</h1>
        <p className="text-muted-foreground text-sm">{props.helper}</p>
      </div>
      <div className="flex flex-col gap-2">
        {props.capabilities.map((capability) => (
          <ModuleToggle
            key={capability.key}
            icon={CAPABILITY_ICONS[capability.key]}
            label={String(props.tr(capability.labelKey as never))}
            helper={String(props.tr(capability.descriptionKey as never))}
            checked={props.enabled.includes(capability.key)}
            onChange={() => props.onToggle(capability.key)}
          />
        ))}
      </div>
    </div>
  );
};

interface StepSetupProps {
  title: string;
  helper: string;
  sections: Array<{
    key: CapabilityKey;
    capability: CapabilityDescriptor;
    options: CapabilityOptionDescriptor[];
  }>;
  values: Record<string, Record<string, boolean>>;
  onToggle: (key: CapabilityKey, option: string) => void;
  soonLabel: string;
  tr: (key: never) => string | number;
}

/**
 * "Set it up" - one section per enabled capability that has something to ask.
 *
 * ⚠️ A capability with no wizard options contributes nothing, which is what
 * lets a Knowledge-only project skip this step entirely rather than see an
 * empty screen. That is also what makes the step count variable, and the
 * button below carries a React 19 hazard because of it.
 */
const StepSetup = (props: StepSetupProps) => {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold tracking-tight">{props.title}</h1>
        <p className="text-muted-foreground text-sm">{props.helper}</p>
      </div>
      {props.sections.map((section) => (
        <div key={section.key} className="flex flex-col gap-2">
          <span className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
            {String(props.tr(section.capability.labelKey as never))}
          </span>
          {section.options.map((option) => (
            <ModuleToggle
              key={option.key}
              icon={CAPABILITY_ICONS[section.key]}
              label={String(props.tr(option.labelKey as never))}
              helper={String(props.tr(option.descriptionKey as never))}
              checked={props.values[section.key]?.[option.key] === true}
              onChange={() => props.onToggle(section.key, option.key)}
              // Rendered disabled rather than hidden: the wizard is where
              // someone decides what Lore is for, and hiding Deploy means the
              // reader who deploys elsewhere never learns Lore will do it.
              disabled={option.soon}
              badge={option.soon ? props.soonLabel : undefined}
            />
          ))}
        </div>
      ))}
    </div>
  );
};

interface ModuleToggleProps {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  helper: string;
  checked: boolean;
  onChange: () => void;
  disabled?: boolean;
  /**
   * A chip beside the label, for an option that exists but is not shipped.
   */
  badge?: string;
}

const ModuleToggle = (props: ModuleToggleProps) => {
  const Icon = props.icon;
  return (
    <button
      type="button"
      onClick={props.onChange}
      aria-pressed={props.checked}
      disabled={props.disabled}
      className={`flex items-start gap-3 rounded-lg border p-4 text-left transition-all ${
        props.disabled
          ? "border-border opacity-60"
          : props.checked
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
        <span className="flex items-center gap-2 text-sm font-semibold">
          {props.label}
          {props.badge ? (
            <span className="bg-muted text-muted-foreground rounded-full px-2 py-0.5 text-[10px] font-medium uppercase">
              {props.badge}
            </span>
          ) : null}
        </span>
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
