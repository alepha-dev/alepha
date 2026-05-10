import { Control } from "@alepha/ui/components/control/control";
import { Alert, AlertDescription } from "@alepha/ui/components/ui/alert";
import { Button } from "@alepha/ui/components/ui/button";
import { Card, CardContent } from "@alepha/ui/components/ui/card";
import { Checkbox } from "@alepha/ui/components/ui/checkbox";
import { Segmented } from "@alepha/ui/components/ui/segmented";
import { TypeBoxError, t } from "alepha";
import { useForm, useFormState } from "alepha/react/form";
import { useRouter } from "alepha/react/router";
import { AlertCircle, CheckCircle2 } from "lucide-react";
import { useEffect, useState } from "react";

export type BeaconFormProps = {};

export interface BeaconContext {
  url: string;
  path: string;
  userAgent: string;
  viewport: { width: number; height: number };
  locale?: string;
  referrer?: string;
}

const BEACON_READY = "alepha-beacon:ready";
const BEACON_CONTEXT = "alepha-beacon:context";
const BEACON_CLOSE = "alepha-beacon:close";

const FALLBACK_CONTEXT_DELAY_MS = 1500;

const buildFallbackContext = (): BeaconContext => ({
  url: typeof document !== "undefined" ? document.referrer : "",
  path: "<unknown>",
  userAgent: typeof navigator !== "undefined" ? navigator.userAgent : "",
  viewport: { width: 0, height: 0 },
});

const BeaconForm = (_props: BeaconFormProps) => {
  const router = useRouter();
  const campaignIdParam = router.state.params.campaignId as
    | string
    | number
    | undefined;
  const token = (router.state.query?.t as string) ?? "";
  const campaignId = Number(campaignIdParam);

  const [beaconContext, setBeaconContext] = useState<BeaconContext | null>(
    null,
  );
  const [screenshot, setScreenshot] = useState<Blob | null>(null);
  const [attachScreenshot, setAttachScreenshot] = useState(true);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  // Ask the parent for context; fall back to a minimal context if none arrives.
  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    let resolved = false;

    const onMessage = (ev: MessageEvent) => {
      const data = ev.data;
      if (!data || data.type !== BEACON_CONTEXT) {
        return;
      }
      resolved = true;
      if (data.context) {
        setBeaconContext(data.context as BeaconContext);
      } else {
        setBeaconContext(buildFallbackContext());
      }
      if (data.screenshot instanceof Blob) {
        setScreenshot(data.screenshot);
      }
    };

    window.addEventListener("message", onMessage);

    if (window.parent && window.parent !== window) {
      window.parent.postMessage({ type: BEACON_READY }, "*");
    }

    const timer = window.setTimeout(() => {
      if (!resolved) {
        setBeaconContext(buildFallbackContext());
      }
    }, FALLBACK_CONTEXT_DELAY_MS);

    return () => {
      window.removeEventListener("message", onMessage);
      window.clearTimeout(timer);
    };
  }, []);

  const postClose = () => {
    if (
      typeof window !== "undefined" &&
      window.parent &&
      window.parent !== window
    ) {
      window.parent.postMessage({ type: BEACON_CLOSE }, "*");
    }
  };

  const form = useForm({
    id: "beacon-form",
    schema: t.object({
      reportType: t.enum(["bug", "feature"], { mode: "text", default: "bug" }),
      title: t.string({
        minLength: 1,
        maxLength: 200,
        title: "Title",
      }),
      description: t.string({
        minLength: 1,
        maxLength: 10_000,
        title: "Description",
      }),
      reporterEmail: t.optional(
        t.string({ format: "email", title: "Email (optional)" }),
      ),
    }),
    initialValues: {
      reportType: "bug",
      title: "",
      description: "",
      reporterEmail: "",
    },
    handler: async (data) => {
      setSubmitError(null);

      const ctx = beaconContext ?? buildFallbackContext();

      let screenshotFileId: string | undefined;
      if (screenshot && attachScreenshot) {
        try {
          const fd = new FormData();
          fd.append(
            "file",
            new File([screenshot], "screenshot.jpg", { type: "image/jpeg" }),
          );
          const res = await fetch(
            `/c/${campaignId}/beacons/screenshot?t=${encodeURIComponent(token)}`,
            { method: "POST", body: fd, keepalive: true },
          );
          if (!res.ok) {
            throw new Error(`Screenshot upload failed (${res.status})`);
          }
          const json = (await res.json()) as { fileId: string };
          screenshotFileId = json.fileId;
        } catch (err) {
          setSubmitError(
            err instanceof Error
              ? `Could not upload screenshot: ${err.message}`
              : "Could not upload screenshot",
          );
          return;
        }
      }

      const body: Record<string, unknown> = {
        title: data.title,
        description: data.description,
        reportType: data.reportType,
        context: ctx,
      };
      if (data.reporterEmail && data.reporterEmail.length > 0) {
        body.reporterEmail = data.reporterEmail;
      }
      if (screenshotFileId) {
        body.screenshotFileId = screenshotFileId;
      }

      const res = await fetch(
        `/c/${campaignId}/beacons?t=${encodeURIComponent(token)}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        },
      );

      if (!res.ok) {
        let message = `Request failed (${res.status})`;
        try {
          const errJson = (await res.json()) as { message?: string };
          if (errJson?.message) {
            message = errJson.message;
          }
        } catch {
          // ignore parse errors
        }
        setSubmitError(message);
        return;
      }

      setSuccess(true);
      // Auto-close after a brief "Thanks!" moment.
      window.setTimeout(postClose, 1200);
    },
  });

  const formState = useFormState(form, ["error"]);
  const formError =
    formState.error && !(formState.error instanceof TypeBoxError)
      ? formState.error.message
      : undefined;

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <div className="flex w-full max-w-md flex-col gap-4">
        <Card>
          <CardContent className="flex flex-col gap-4 p-6">
            {success ? (
              <div className="flex flex-col items-center gap-3 py-6 text-center">
                <CheckCircle2 className="size-10 text-emerald-500" />
                <h2 className="text-lg font-semibold">Thanks!</h2>
                <p className="text-muted-foreground text-sm">
                  Your report has been sent.
                </p>
              </div>
            ) : (
              <>
                <h1 className="text-center text-base font-medium">
                  Send feedback
                </h1>

                {(formError || submitError) && (
                  <Alert variant="destructive">
                    <AlertCircle className="size-4" />
                    <AlertDescription>
                      {submitError || formError}
                    </AlertDescription>
                  </Alert>
                )}

                <form {...form.props} className="flex flex-col gap-3">
                  <Control
                    label="Type"
                    input={form.input.reportType}
                    custom={({ value, onChange }) => (
                      <Segmented
                        value={value != null ? String(value) : "bug"}
                        onChange={(v) => onChange(v)}
                        options={[
                          { value: "bug", label: "Bug" },
                          { value: "feature", label: "Feature" },
                        ]}
                        fullWidth
                      />
                    )}
                  />

                  <Control label="Title" input={form.input.title} text />

                  <Control
                    label="Description"
                    input={form.input.description}
                    area
                  />

                  <Control
                    label="Email (optional)"
                    input={form.input.reporterEmail}
                    text
                  />

                  {screenshot && (
                    <label className="flex cursor-pointer items-center gap-2 text-sm">
                      <Checkbox
                        checked={attachScreenshot}
                        onCheckedChange={(v) => setAttachScreenshot(v === true)}
                      />
                      <span>Attach screenshot</span>
                    </label>
                  )}

                  <div className="flex justify-end gap-2 pt-2">
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={postClose}
                      disabled={form.submitting}
                    >
                      Cancel
                    </Button>
                    <Button type="submit" disabled={form.submitting}>
                      {form.submitting ? "Sending..." : "Send"}
                    </Button>
                  </div>
                </form>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default BeaconForm;
