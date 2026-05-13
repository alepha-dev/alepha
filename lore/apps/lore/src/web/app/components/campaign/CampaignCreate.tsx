import { Control } from "@alepha/ui/components/control/control";
import { ControlUpload } from "@alepha/ui/components/control-upload/control-upload";
import { Button } from "@alepha/ui/components/ui/button";
import { Card, CardContent } from "@alepha/ui/components/ui/card";
import { t } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { useAlepha, useClient, useInject } from "alepha/react";
import { useAuth } from "alepha/react/auth";
import { useForm, useFormState } from "alepha/react/form";
import { useI18n } from "alepha/react/i18n";
import { useRouter } from "alepha/react/router";
import { ArrowLeft, ArrowRight, Globe2, Hammer, Lock, Tag } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import type { CampaignController } from "@/api/controllers/CampaignController.ts";
import type { AppRouter } from "../../AppRouter.ts";
import { userCampaignsAtom } from "../../atoms/userCampaignsAtom.ts";
import type { I18n } from "../../services/I18n.ts";
import PageHeader from "../shared/header/PageHeader.tsx";

const TOTAL_STEPS = 3;
const MIN_BUILD_DURATION_MS = 1500;

const CampaignCreate = () => {
  const client = useClient<CampaignController>();
  const router = useRouter<AppRouter>();
  const auth = useAuth();
  const alepha = useAlepha();
  const dateTime = useInject(DateTimeProvider);
  const { tr } = useI18n<I18n, "en">();
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);

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
    schema: t.object({
      title: t.string({ minLength: 3, maxLength: 24 }),
      public: t.optional(t.boolean()),
      icon: t.optional(t.uuid()),
    }),
    onError: (error) => {
      toast.error(error.message);
    },
    handler: async (body) => {
      setStep(4);
      const startedAt = dateTime.nowMillis();
      const campaign = await client.createCampaign({ body });
      const elapsed = dateTime.nowMillis() - startedAt;
      if (elapsed < MIN_BUILD_DURATION_MS) {
        await new Promise((r) =>
          setTimeout(r, MIN_BUILD_DURATION_MS - elapsed),
        );
      }

      alepha.store.set(userCampaignsAtom, await client.getHomeOverview());

      await router.push("campaign", {
        params: { campaignId: String(campaign.id) },
        meta: { firstOpen: true },
      });
    },
  });

  const formState = useFormState(form, ["values"]);
  const titleValue = String(formState.values?.title ?? "").trim();
  const canAdvanceFromName = titleValue.length >= 3;

  const titleInputId = form.input.title.props.id;
  useEffect(() => {
    if (step !== 1 || !titleInputId) return;
    const el = document.getElementById(titleInputId) as HTMLInputElement | null;
    el?.focus();
  }, [step, titleInputId]);

  useEffect(() => {
    if (!auth.user) {
      router.push("register", {
        query: { r: router.path("campaignCreate") },
      });
    }
  }, [auth.user, router]);

  const goNext = () =>
    setStep((s) => Math.min(TOTAL_STEPS, s + 1) as 1 | 2 | 3);
  const goBack = () => setStep((s) => Math.max(1, s - 1) as 1 | 2 | 3);

  if (step === 4) {
    return (
      <div className="bg-background flex h-screen w-full flex-col items-center justify-center">
        <PageHeader showHome={false} />
        <BuildingScreen message={String(tr("campaign.create.building"))} />
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
                className="animate-in fade-in slide-in-from-right-2 duration-300 flex flex-col gap-5"
              >
                {step === 1 && (
                  <StepName
                    title={String(tr("campaign.create.step.name"))}
                    nameLabel={String(tr("campaign.create.name"))}
                    nameHelper={String(tr("campaign.create.name.helper"))}
                    input={form.input.title}
                  />
                )}
                {step === 2 && (
                  <StepLogo
                    title={String(tr("campaign.create.step.logo"))}
                    helper={String(tr("campaign.create.step.logo.helper"))}
                    input={form.input.icon}
                    disabled={form.submitting}
                  />
                )}
                {step === 3 && (
                  <StepVisibility
                    title={String(tr("campaign.create.step.visibility"))}
                    privateLabel={String(
                      tr("campaign.create.visibility.private"),
                    )}
                    privateHelper={String(
                      tr("campaign.create.visibility.private.helper"),
                    )}
                    publicLabel={String(tr("campaign.create.public"))}
                    publicHelper={String(
                      tr("campaign.create.visibility.public.helper"),
                    )}
                    value={
                      (formState.values?.public as boolean | undefined) ?? false
                    }
                    onChange={(v) => form.input.public.set(v)}
                  />
                )}
              </div>

              <div className="flex items-center justify-between gap-3">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={goBack}
                  disabled={step === 1 || form.submitting}
                >
                  <ArrowLeft className="size-4" />
                  {tr("campaign.create.back")}
                </Button>

                <div className="flex items-center gap-2">
                  {step === 2 && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={goNext}
                    >
                      {tr("campaign.create.skip")}
                    </Button>
                  )}
                  {step < TOTAL_STEPS ? (
                    <Button
                      type="button"
                      size="lg"
                      onClick={goNext}
                      disabled={step === 1 && !canAdvanceFromName}
                      className="h-11 px-6"
                    >
                      {tr("campaign.create.next")}
                      <ArrowRight className="size-4" />
                    </Button>
                  ) : (
                    <Button
                      type="submit"
                      size="lg"
                      disabled={form.submitting || !canAdvanceFromName}
                      className="h-11 px-6"
                    >
                      <Hammer className="size-4" />
                      {tr("campaign.create.submit")}
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

export default CampaignCreate;

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
      <ControlUpload
        input={props.input}
        accept="image/*"
        maxSize={2 * 1024 * 1024}
        bucket="campaign-icons"
        disabled={props.disabled}
      />
    </div>
  );
};

interface StepVisibilityProps {
  title: string;
  privateLabel: string;
  privateHelper: string;
  publicLabel: string;
  publicHelper: string;
  value: boolean;
  onChange: (value: boolean) => void;
}

const StepVisibility = (props: StepVisibilityProps) => {
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-bold tracking-tight">{props.title}</h1>
      <div className="flex flex-col gap-2">
        <VisibilityOption
          icon={Lock}
          label={props.privateLabel}
          helper={props.privateHelper}
          selected={!props.value}
          onSelect={() => props.onChange(false)}
        />
        <VisibilityOption
          icon={Globe2}
          label={props.publicLabel}
          helper={props.publicHelper}
          selected={props.value}
          onSelect={() => props.onChange(true)}
        />
      </div>
    </div>
  );
};

interface VisibilityOptionProps {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  helper: string;
  selected: boolean;
  onSelect: () => void;
}

const VisibilityOption = (props: VisibilityOptionProps) => {
  const Icon = props.icon;
  return (
    <button
      type="button"
      onClick={props.onSelect}
      className={`flex items-start gap-3 rounded-lg border p-4 text-left transition-all ${
        props.selected
          ? "border-primary bg-primary/5 ring-1 ring-primary/30"
          : "border-border hover:border-muted-foreground/40 hover:bg-muted/30"
      }`}
    >
      <div
        className={`mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-md ${
          props.selected
            ? "bg-primary/10 text-primary"
            : "bg-muted text-muted-foreground"
        }`}
      >
        <Icon className="size-4" />
      </div>
      <div className="flex flex-col gap-0.5">
        <span className="text-sm font-semibold">{props.label}</span>
        <span className="text-muted-foreground text-xs">{props.helper}</span>
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
