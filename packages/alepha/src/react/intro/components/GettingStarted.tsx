import { useCallback, useEffect, useMemo, useState } from "react";
import "./GettingStarted.css";
import { useRouter } from "alepha/react/router";
import type { ReactNode } from "react";

type Step = {
  num: string;
  text: ReactNode;
};

type Message = {
  text: string;
  sub: string;
  detail?: string;
  steps?: Step[];
  links?: { label: string; href: string }[];
};

const messages: Message[] = [
  {
    text: "Let's begin.",
    sub: "Every story starts with a blank page.",
    detail: "This one is yours.",
  },
  {
    text: "Need help?",
    sub: "We've got you covered.",
    detail: "Even our AI friends can read the docs.",
    links: [
      { label: "alepha.dev", href: "https://alepha.dev" },
      { label: "llms.txt", href: "https://alepha.dev/llms.txt" },
    ],
  },
];

/**
 * A welcome component displayed when creating a new Alepha application.
 */
const GettingStarted = () => {
  const [index, setIndex] = useState(0);
  const [direction, setDirection] = useState<"next" | "prev">("next");

  const router = useRouter();
  const hasAdmin = router.pages.find((it) => it.name === "adminLayout");
  const hasAuth = router.pages.find((it) => it.name === "authLayout");

  const adminAnchorProps = hasAdmin
    ? router.anchor(router.path("adminLayout"))
    : undefined;
  const authAnchorProps = hasAuth
    ? router.anchor(router.path("login"))
    : undefined;

  const filteredMessages = useMemo(() => {
    const result: Message[] = [];

    // Add static messages up to "What's next?"
    for (const msg of messages) {
      if (msg.text === "Need help?") break;
      result.push(msg);
    }

    // Add auth message if available
    if (hasAuth && authAnchorProps) {
      result.push({
        text: "Who are you?",
        sub: "Create your first account.",
        steps: [
          {
            num: "1",
            text: (
              <>
                Sign up at <a {...authAnchorProps}>/auth/login</a>
              </>
            ),
          },
          {
            num: "2",
            text: (
              <>
                Customize in <code>src/api/AppSecurity.ts</code>
              </>
            ),
          },
        ],
      });
    }

    // Add admin message if available
    if (hasAdmin && adminAnchorProps) {
      result.push({
        text: "Take the wheel.",
        sub: "Become admin in three steps.",
        steps: [
          {
            num: "1",
            text: (
              <>
                Add your email to <code>adminEmails</code> in{" "}
                <code>AppSecurity.ts</code>
              </>
            ),
          },
          { num: "2", text: "Create a user account with that email" },
          {
            num: "3",
            text: (
              <>
                Go to <a {...adminAnchorProps}>/admin</a>
              </>
            ),
          },
        ],
      });
    }

    // Add "Need help?" message
    const helpMsg = messages.find((msg) => msg.text === "Need help?");
    if (helpMsg) {
      result.push(helpMsg);
    }

    return result;
  }, [hasAuth, hasAdmin, authAnchorProps, adminAnchorProps]);

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
  );
};

export default GettingStarted;
