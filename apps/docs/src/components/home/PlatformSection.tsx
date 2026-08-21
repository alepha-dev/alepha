import { useEffect, useState } from "react";

import { snippets } from "../../config/docs.ts";
import CodePane from "./CodePane.tsx";
import DocLink from "./DocLink.tsx";

/**
 * Config in, command out, and the run underneath.
 *
 * The stage list replays on a loop rather than sitting still, because the
 * argument is that one invocation does all of this in order and you watch none
 * of it.
 *
 * The order is the orchestrator's own, not a guess: `PlatformOrchestrator.up()`
 * runs authenticate → provision → build → migrate → deploy → secrets. Secrets
 * really are last - `secret put` needs the worker to exist, so on a first
 * deploy there is nothing to attach them to.
 */
const STAGES = [
  "authenticating",
  "provisioning",
  "building",
  "running migrations",
  "deploying",
  "pushing secrets",
];

/**
 * How long the summary line holds before the run starts over.
 */
const RESULT_MS = 5000;

const PlatformSection = () => {
  // How many stages have completed. Starts finished so the prerendered HTML
  // - and anyone without JavaScript - gets a deploy that ran, not one frozen
  // half way through. The effect resets it and takes over on mount.
  const [done, setDone] = useState(STAGES.length);

  // Timing lives here rather than in CSS keyframes because each stage should
  // take its own time. A shared animation-delay gives every row the same
  // beat, which reads as a progress bar in six pieces instead of six things
  // that each had to finish before the next could start.
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      return;
    }

    let timer: ReturnType<typeof setTimeout>;

    // A stage takes between one and two seconds; the last one hands over to
    // the summary, which holds for RESULT_MS before the run clears.
    const advance = (count: number) => {
      setDone(count);
      const wait =
        count === STAGES.length ? RESULT_MS : 1000 + Math.random() * 1000;
      timer = setTimeout(
        () => advance(count === STAGES.length ? 0 : count + 1),
        wait,
      );
    };

    advance(0);
    return () => clearTimeout(timer);
  }, []);

  return (
    <section id="platform" className="home-block home-section">
      <div className="container-wide container">
        <div className="section-head">
          <h2 className="section-title">Deploy with one command</h2>
          <p className="section-sub">
            The database, the bucket and the queue do not exist yet. You are not
            going to create them, and you are not going to write the pipeline
            that does.
          </p>
        </div>

        <div className="deploy-flow">
          {/* Same build-time highlighter as the other code on this page; the
              snippet lives in scripts/snippets.ts. */}
          <CodePane html={snippets.platform} />

          {/* Command and output in one terminal rather than two panels: a
              prompt line followed by what it printed is what actually happens,
              and it pairs with the config pane instead of trailing after it. */}
          <div className="deploy-term">
            <span className="deploy-term-head">terminal</span>
            <div className="deploy-term-body">
              <div className="deploy-cmd">
                <span className="deploy-prompt">$</span>
                <code>alepha platform up --env production</code>
              </div>

              {/* Every stage is on screen from the start, dim, and brightens
                  when it completes. Printing them one at a time would be more
                  literal, but the panel would grow six times per loop and drag
                  the section under it along with it. */}
              <ol className="deploy-log">
                {STAGES.map((stage, index) => (
                  <li
                    className={
                      index < done ? "deploy-step is-done" : "deploy-step"
                    }
                    key={stage}
                  >
                    <span className="deploy-step-mark" aria-hidden="true" />
                    <span className="deploy-step-label">{stage}</span>
                  </li>
                ))}
              </ol>

              {/* What `printUpSummary` actually prints: a green arrow and the
                  URL in cyan, no label. The host is the `domain` declared in
                  the config pane beside it. Absent until the run finishes,
                  rather than dimmed, because a deploy that has not finished
                  has printed no URL at all. */}
              <p
                className={
                  done === STAGES.length
                    ? "deploy-result is-visible"
                    : "deploy-result"
                }
              >
                <span className="deploy-result-arrow" aria-hidden="true">
                  →
                </span>
                <span className="deploy-result-url">
                  https://lore.alepha.dev
                </span>
              </p>
            </div>
          </div>
        </div>

        <p className="platform-footnote">
          Missing infrastructure is created during provisioning: D1, KV, R2 and
          Queues, from the bindings your code already declares, because Alepha
          knows the topology of your app. The command handles the rest of it
          too, from pushing{" "}
          <DocLink to="guides-core-configurations">secrets</DocLink> to running{" "}
          <DocLink to="guides-persistence-migrations">migrations</DocLink>.{" "}
          <DocLink to="cli-plugins-platform">Alepha Platform</DocLink> targets{" "}
          <DocLink to="guides-deployment-cloudflare">Cloudflare</DocLink> and{" "}
          <DocLink to="guides-deployment-bay">Bay (VPS)</DocLink> only.
        </p>
      </div>
    </section>
  );
};

export default PlatformSection;
