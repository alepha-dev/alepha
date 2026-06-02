import { useEffect, useRef, useState } from "react";
import { ScreenshotEditor } from "./ScreenshotEditor.tsx";

/**
 * Props for the SigilDialog component.
 */
export interface SigilDialogProps {
  /** Called when the dialog should be closed. */
  onClose: () => void;
  /**
   * Optional reporter email to include in petition submissions.
   * When provided, it is sent as the `reporterEmail` field in the multipart form.
   */
  reporterEmail?: string;
}

/**
 * Feedback/petition dialog for Sigil.
 *
 * On mount, attempts a best-effort screenshot via `html2canvas-pro`. If capture
 * fails (e.g., in jsdom or when the library is unavailable) the dialog still
 * renders without a screenshot section — the field is always optional.
 *
 * Submits a multipart `POST /api/sigil/petition` with title, description, type,
 * hostUrl, hostPath, optional reporterEmail, and optional annotated screenshot.
 */
export const SigilDialog = (props: SigilDialogProps) => {
  const [capturing, setCapturing] = useState(true);
  const [screenshotDataUrl, setScreenshotDataUrl] = useState<string | null>(
    null,
  );
  const [screenshotFile, setScreenshotFile] = useState<File | null>(null);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [type, setType] = useState<"bug" | "feature">("bug");

  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState<{
    message: string;
    variant: "success" | "error";
  } | null>(null);

  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Capture screenshot on mount. Wrapped in try/catch so jsdom failures are silent.
  const capture = () => {
    setCapturing(true);
    setScreenshotDataUrl(null);
    setScreenshotFile(null);

    void (async () => {
      try {
        const { default: html2canvas } = await import("html2canvas-pro");
        const canvas = await html2canvas(document.body, {
          useCORS: true,
          logging: false,
          windowWidth: document.documentElement.clientWidth,
          windowHeight: document.documentElement.clientHeight,
          width: document.documentElement.clientWidth,
          height: document.documentElement.clientHeight,
          x: window.scrollX,
          y: window.scrollY,
        });
        const dataUrl = canvas.toDataURL("image/png");
        const blob = await new Promise<Blob | null>((resolve) =>
          canvas.toBlob(resolve, "image/png"),
        );
        if (blob) {
          const file = new File([blob], "screenshot.png", {
            type: "image/png",
          });
          setScreenshotDataUrl(dataUrl);
          setScreenshotFile(file);
        }
      } catch {
        // Capture unavailable (jsdom, CSP, etc.) — proceed without screenshot.
      } finally {
        setCapturing(false);
      }
    })();
  };

  // Run capture once on mount.
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentional mount-only effect
  useEffect(() => {
    capture();
  }, []);

  // Clean up any lingering toast timer on unmount.
  useEffect(() => {
    return () => {
      if (toastTimerRef.current !== null) {
        clearTimeout(toastTimerRef.current);
      }
    };
  }, []);

  const showToast = (message: string, variant: "success" | "error") => {
    setToast({ message, variant });
    if (toastTimerRef.current !== null) {
      clearTimeout(toastTimerRef.current);
    }
    toastTimerRef.current = setTimeout(() => {
      setToast(null);
    }, 3000);
  };

  const handleImageChange = (file: File) => {
    setScreenshotFile(file);
    const url = URL.createObjectURL(file);
    setScreenshotDataUrl(url);
  };

  const handleRecapture = () => {
    capture();
  };

  const handleSubmit = async () => {
    if (!title.trim() || submitting) return;
    setSubmitting(true);
    try {
      const form = new FormData();
      form.set("title", title.trim());
      form.set("description", description.trim());
      form.set("type", type);
      form.set("hostUrl", window.location.href);
      form.set("hostPath", window.location.pathname + window.location.search);
      if (props.reporterEmail) {
        form.set("reporterEmail", props.reporterEmail);
      }
      if (screenshotFile) {
        form.set("screenshot", screenshotFile, "screenshot.png");
      }

      const res = await fetch("/api/sigil/petition", {
        method: "POST",
        body: form,
        credentials: "same-origin",
        // NOTE: Do NOT set Content-Type — the browser sets it with the multipart boundary.
      });

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }

      showToast("Thanks!", "success");
      toastTimerRef.current = setTimeout(() => {
        props.onClose();
      }, 2000);
    } catch {
      showToast("Something went wrong. Please try again.", "error");
    } finally {
      setSubmitting(false);
    }
  };

  const isSubmitDisabled = !title.trim() || submitting;

  return (
    <div className="sigil-dialog__backdrop">
      <div className="sigil-dialog" role="dialog" aria-modal="true">
        <div className="sigil-dialog__panel">
          <button
            type="button"
            className="sigil-dialog__close"
            aria-label="Close"
            onClick={props.onClose}
          >
            ✕
          </button>

          <h2 className="sigil-dialog__title">Send feedback</h2>

          {/* Screenshot section */}
          {capturing && (
            <p style={{ fontSize: "0.875rem", color: "#6b7280" }}>Capturing…</p>
          )}
          {!capturing && screenshotDataUrl && (
            <ScreenshotEditor
              image={screenshotDataUrl}
              onImageChange={handleImageChange}
              onRecapture={handleRecapture}
            />
          )}

          {/* Form fields */}
          <div
            className="sigil-field"
            style={{ marginTop: screenshotDataUrl ? "1rem" : undefined }}
          >
            <label className="sigil-field__label" htmlFor="sigil-title">
              Title <span aria-hidden="true">*</span>
            </label>
            <input
              id="sigil-title"
              className="sigil-input"
              type="text"
              placeholder="Short summary…"
              value={title}
              maxLength={255}
              required
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>

          <div className="sigil-field" style={{ marginTop: "0.75rem" }}>
            <label className="sigil-field__label" htmlFor="sigil-description">
              Description
            </label>
            <textarea
              id="sigil-description"
              className="sigil-textarea"
              placeholder="More details…"
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>

          <div className="sigil-field" style={{ marginTop: "0.75rem" }}>
            <span className="sigil-field__label">Type</span>
            <div
              style={{ display: "flex", gap: "0.5rem", marginTop: "0.25rem" }}
            >
              <button
                type="button"
                className={`sigil-btn sigil-btn--mode${type === "bug" ? " sigil-btn--active" : ""}`}
                aria-pressed={type === "bug"}
                onClick={() => setType("bug")}
              >
                Bug
              </button>
              <button
                type="button"
                className={`sigil-btn sigil-btn--mode${type === "feature" ? " sigil-btn--active" : ""}`}
                aria-pressed={type === "feature"}
                onClick={() => setType("feature")}
              >
                Feature
              </button>
            </div>
          </div>

          <button
            type="button"
            className="sigil-btn sigil-btn--primary"
            style={{ width: "100%", marginTop: "1.25rem" }}
            disabled={isSubmitDisabled}
            onClick={handleSubmit}
          >
            {submitting ? "Sending…" : "Send feedback"}
          </button>
        </div>
      </div>

      {toast && (
        <div
          className={`sigil-toast sigil-toast--${toast.variant}`}
          role="status"
          aria-live="polite"
        >
          {toast.message}
        </div>
      )}
    </div>
  );
};
