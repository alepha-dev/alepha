import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useAdminSlide } from "./GettingStartedAdminSlide.tsx";
import { useAuthSlide } from "./GettingStartedAuthSlide.tsx";
import { useDevtoolsSlide } from "./GettingStartedDevtoolsSlide.tsx";

export type GettingStartedStep = {
  num: string;
  text: ReactNode;
};

export type GettingStartedSlide = {
  text: string;
  sub: string;
  detail?: string;
  steps?: GettingStartedStep[];
  links?: { label: string; href: string }[];
};

export type GettingStartedWelcome = {
  appName: string;
  serverTime: string;
};

export type GettingStartedProps = {
  /**
   * Welcome data loaded from the server via SSR.
   *
   * When provided, displays app name and server timestamp on the first slide,
   * demonstrating the full SSR → hydration data flow.
   */
  welcome?: GettingStartedWelcome;
};

const defaultFirstSlide: GettingStartedSlide = {
  text: "Let's begin.",
  sub: "Every story starts with a blank page.",
  detail: "This one is yours.",
};

const helpSlide: GettingStartedSlide = {
  text: "Need help?",
  sub: "We've got you covered.",
  detail: "Even our AI friends can read the docs.",
  links: [
    { label: "alepha.dev", href: "https://alepha.dev" },
    { label: "llms.txt", href: "https://alepha.dev/llms.txt" },
  ],
};

const formatServerTime = (isoString: string): string => {
  try {
    const date = new Date(isoString);
    return date.toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return isoString;
  }
};

/**
 * A welcome component displayed when creating a new Alepha application.
 */
const GettingStarted = ({ welcome }: GettingStartedProps) => {
  const [index, setIndex] = useState(0);
  const [direction, setDirection] = useState<"next" | "prev">("next");

  // The devtools slide is decided by `import.meta.env.VITE_ALEPHA_DEVTOOLS`,
  // which the client bundle has substituted at transform time and the SSR
  // module graph does not — so the server rendered one slide fewer than the
  // client and every new project's first page load logged a hydration
  // mismatch. Gating it on mount makes the first client render match the
  // server's by construction, whatever the env says; the slide appears in the
  // commit right after. Anything else that can only be known in the browser
  // belongs behind this flag too.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // Get auth-aware slide content (hooks return undefined if routes don't exist)
  const authSlide = useAuthSlide();
  const adminSlide = useAdminSlide();
  const devtoolsSlide = useDevtoolsSlide();

  const filteredMessages = useMemo(() => {
    const result: GettingStartedSlide[] = [];

    // First slide: use welcome data if provided, otherwise default
    if (welcome) {
      result.push({
        ...defaultFirstSlide,
        detail: `Server time: ${formatServerTime(welcome.serverTime)} - App: ${welcome.appName}`,
      });
    } else {
      result.push(defaultFirstSlide);
    }

    // Add auth slide if auth routes exist
    if (authSlide) {
      result.push(authSlide);
    }

    // Add admin slide if admin routes exist
    if (adminSlide) {
      result.push(adminSlide);
    }

    // Add devtools slide in non-production environments — client-only, see
    // `mounted` above.
    if (mounted && devtoolsSlide) {
      result.push(devtoolsSlide);
    }

    // Add "Need help?" message
    result.push(helpSlide);

    return result;
  }, [welcome, authSlide, adminSlide, devtoolsSlide, mounted]);

  const current = filteredMessages[index];

  const prev = useCallback(() => {
    setDirection("prev");
    setIndex(
      (i) => (i - 1 + filteredMessages.length) % filteredMessages.length,
    );
  }, [filteredMessages.length]);

  const next = useCallback(() => {
    setDirection("next");
    setIndex((i) => (i + 1) % filteredMessages.length);
  }, [filteredMessages.length]);

  const goTo = useCallback(
    (i: number) => {
      setDirection(i > index ? "next" : "prev");
      setIndex(i);
    },
    [index],
  );

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") {
        prev();
      } else if (e.key === "ArrowRight") {
        next();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [prev, next]);

  return (
    <>
      <style>{styles}</style>
      <main className="alepha-blank">
        <div className="alepha-blank-content">
          <div className="alepha-blank-text-block">
            <h1
              className={`alepha-blank-message alepha-blank-slide-${direction}`}
              key={index}
            >
              {current.text}
            </h1>
            <p
              className={`alepha-blank-sub alepha-blank-slide-${direction}`}
              key={`sub-${index}`}
            >
              {current.sub}
            </p>
            {current.detail && (
              <p
                className={`alepha-blank-detail alepha-blank-slide-${direction}`}
                key={`detail-${index}`}
              >
                {current.detail}
              </p>
            )}
            {current.steps && (
              <div
                className={`alepha-blank-steps alepha-blank-slide-${direction}`}
                key={`steps-${index}`}
              >
                {current.steps.map((step, i) => (
                  <div
                    key={i}
                    className="alepha-blank-step"
                    style={{ animationDelay: `${0.15 + i * 0.08}s` }}
                  >
                    <span className="alepha-blank-step-num">{step.num}</span>
                    <span className="alepha-blank-step-text">{step.text}</span>
                  </div>
                ))}
              </div>
            )}
            {current.links && (
              <div
                className={`alepha-blank-links alepha-blank-slide-${direction}`}
                key={`links-${index}`}
              >
                {current.links.map((link, i) => (
                  <a
                    key={link.href}
                    href={link.href}
                    target={link.href.startsWith("http") ? "_blank" : undefined}
                    rel={
                      link.href.startsWith("http")
                        ? "noopener noreferrer"
                        : undefined
                    }
                    style={{ animationDelay: `${0.1 + i * 0.05}s` }}
                  >
                    {link.label}
                  </a>
                ))}
              </div>
            )}
          </div>

          <div className="alepha-blank-slider">
            <button
              className="alepha-blank-nav-btn"
              onClick={prev}
              aria-label="Previous"
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path
                  d="M9 3L5 7L9 11"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
            <div className="alepha-blank-dots">
              {filteredMessages.map((_, i) => (
                <button
                  key={i}
                  className={`alepha-blank-dot ${i === index ? "active" : ""}`}
                  onClick={() => goTo(i)}
                  aria-label={`Go to message ${i + 1}`}
                />
              ))}
            </div>
            <button
              className="alepha-blank-nav-btn"
              onClick={next}
              aria-label="Next"
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path
                  d="M5 3L9 7L5 11"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
          </div>

          <div className="alepha-blank-hint">
            <kbd>←</kbd> <kbd>→</kbd> to navigate
          </div>
        </div>
      </main>
    </>
  );
};

export default GettingStarted;

const styles = `
.alepha-blank {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 100svh;
  background: #fafafa;
  font-family: system-ui, -apple-system, sans-serif;
  color: #171717;
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  top: 0;
  width: 100%;
}

.alepha-blank-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  max-width: 640px;
}

.alepha-blank-text-block {
  min-height: 320px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
}

.alepha-blank-message {
  font-size: clamp(2rem, 8vw, 3rem);
  font-weight: 600;
  letter-spacing: -0.02em;
  margin: 0;
  line-height: 1.1;
}

.alepha-blank-sub {
  font-size: 1.0625rem;
  color: #525252;
  margin: 1rem 0 0;
  font-weight: 400;
  line-height: 1.5;
}

.alepha-blank-detail {
  font-size: 0.875rem;
  color: #a3a3a3;
  margin: 0.5rem 0 0;
  font-weight: 400;
  line-height: 1.5;
}

.alepha-blank-slide-next {
  animation: alepha-blank-slideNext 0.4s cubic-bezier(0.22, 1, 0.36, 1) both;
}

.alepha-blank-slide-prev {
  animation: alepha-blank-slidePrev 0.4s cubic-bezier(0.22, 1, 0.36, 1) both;
}

@keyframes alepha-blank-slideNext {
  from {
    opacity: 0;
    transform: translateX(20px);
  }
  to {
    opacity: 1;
    transform: translateX(0);
  }
}

@keyframes alepha-blank-slidePrev {
  from {
    opacity: 0;
    transform: translateX(-20px);
  }
  to {
    opacity: 1;
    transform: translateX(0);
  }
}

.alepha-blank-steps {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  margin-top: 1.25rem;
  text-align: left;
}

.alepha-blank-step {
  display: flex;
  align-items: center;
  gap: 0.625rem;
  padding: 0.25rem 0;
  opacity: 0;
  animation: alepha-blank-stepIn 0.4s cubic-bezier(0.22, 1, 0.36, 1) forwards;
}

.alepha-blank-step-num {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: #171717;
  color: #fff;
  font-size: 0.6875rem;
  font-weight: 600;
  flex-shrink: 0;
}

.alepha-blank-step-text {
  font-size: 0.8125rem;
  color: #525252;
  line-height: 1.5;
}

.alepha-blank-step-text code {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 0.75rem;
  background: #f5f5f5;
  color: #171717;
  padding: 0.0625rem 0.375rem;
  border-radius: 3px;
  border: 1px solid #e5e5e5;
}

.alepha-blank-step-text a {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  color: #525252;
  text-decoration: underline;
  text-underline-offset: 2px;
  transition: color 0.15s ease;
}

.alepha-blank-step-text a:hover {
  color: #171717;
}

@keyframes alepha-blank-stepIn {
  from {
    opacity: 0;
    transform: translateY(10px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.alepha-blank-links {
  display: flex;
  gap: 1.5rem;
  margin-top: 1.25rem;
}

.alepha-blank-links a {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 0.875rem;
  color: #525252;
  text-decoration: none;
  position: relative;
  opacity: 0;
  animation: alepha-blank-fadeIn 0.3s ease-out forwards;
  transition: color 0.2s ease;
}

.alepha-blank-links a::after {
  content: "";
  position: absolute;
  left: 0;
  right: 0;
  bottom: -2px;
  height: 1px;
  background: #a3a3a3;
  transform: scaleX(1);
  transform-origin: left;
  transition:
    transform 0.25s cubic-bezier(0.22, 1, 0.36, 1),
    background 0.2s ease;
}

.alepha-blank-links a:hover {
  color: #171717;
}

.alepha-blank-links a:hover::after {
  background: #171717;
  transform: scaleX(1.05);
}

.alepha-blank-slider {
  display: flex;
  align-items: center;
  gap: 1rem;
  margin-top: 2.5rem;
}

.alepha-blank-dots {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.alepha-blank-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: transparent;
  border: 1.5px solid #d4d4d4;
  padding: 0;
  cursor: pointer;
  transition: all 0.25s cubic-bezier(0.22, 1, 0.36, 1);
}

.alepha-blank-dot:hover {
  border-color: #a3a3a3;
  transform: scale(1.2);
}

.alepha-blank-dot:focus-visible {
  outline: 2px solid #737373;
  outline-offset: 2px;
}

.alepha-blank-dot.active {
  background: #737373;
  border-color: #737373;
  transform: scale(1.1);
}

.alepha-blank-nav-btn {
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  font-family: inherit;
  background: transparent;
  color: #a3a3a3;
  border: 1.5px solid transparent;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s cubic-bezier(0.22, 1, 0.36, 1);
}

.alepha-blank-nav-btn:hover {
  color: #525252;
  background: #f0f0f0;
}

.alepha-blank-nav-btn:focus-visible {
  outline: none;
  border-color: #737373;
  color: #525252;
}

.alepha-blank-nav-btn:active {
  transform: scale(0.92);
  background: #e5e5e5;
}

.alepha-blank-hint {
  margin-top: 2rem;
  font-size: 0.75rem;
  color: #a3a3a3;
  display: flex;
  align-items: center;
  gap: 0.375rem;
  opacity: 0;
  animation: alepha-blank-fadeIn 0.5s ease-out 0.5s forwards;
}

.alepha-blank-hint kbd {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 0.6875rem;
  background: #f0f0f0;
  border: 1px solid #e5e5e5;
  border-radius: 4px;
  padding: 0.125rem 0.375rem;
  box-shadow: 0 1px 0 #d4d4d4;
}

@keyframes alepha-blank-fadeIn {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}

@media (prefers-reduced-motion: reduce) {
  .alepha-blank-slide-next,
  .alepha-blank-slide-prev,
  .alepha-blank-links a,
  .alepha-blank-hint,
  .alepha-blank-step {
    animation: none;
    opacity: 1;
  }

  .alepha-blank-dot,
  .alepha-blank-nav-btn,
  .alepha-blank-links a,
  .alepha-blank-links a::after {
    transition: none;
  }
}
`;
