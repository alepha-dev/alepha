import { snippets } from "../../config/docs.ts";
import CodePane from "./CodePane.tsx";
import DocLink from "./DocLink.tsx";

/**
 * Config in, command out, and the run underneath.
 *
 * The stage list replays on a loop rather than sitting still, because the
 * argument is that one invocation does all of this in order and you watch none
 * of it. Timing lives in CSS so the block costs no JavaScript and stops moving
 * under `prefers-reduced-motion`.
 *
 * The order is the orchestrator's own, not a guess: `PlatformOrchestrator.up()`
 * runs authenticate → provision → build → migrate → deploy → secrets. Secrets
 * really are last — `secret put` needs the worker to exist, so on a first
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

const PlatformSection = () => {
  return (
    <section id="platform" className="home-block home-section">
      <div className="container container-wide">
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

              {/* No per-item `animation-delay`: each step carries its own
                  keyframes so the whole list resets on the same frame.
                  Staggering one shared animation made them light and clear at
                  six different moments, which read as blinking rather than a
                  run. */}
              <ol className="deploy-log">
                {STAGES.map((stage) => (
                  <li className="deploy-step" key={stage}>
                    <span className="deploy-step-mark" aria-hidden="true" />
                    <span className="deploy-step-label">{stage}</span>
                  </li>
                ))}
              </ol>

              {/* What `printUpSummary` actually prints: a green arrow and the
                  URL in cyan, no label. The host is the `domain` declared in
                  the config pane beside it. */}
              <p className="deploy-result">
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
          Queues, from the bindings your code already declares.{" "}
          <DocLink to="guides-persistence-migrations">Migrations</DocLink> run
          before the new code can see the database, and secrets go last on
          purpose, after the worker exists, because before that there is nothing
          to attach them to.{" "}
          <DocLink to="cli-plugins-platform">Alepha Platform</DocLink> targets{" "}
          <DocLink to="guides-deployment-cloudflare">Cloudflare</DocLink> and{" "}
          <DocLink to="guides-deployment-bay">Bay</DocLink> only.
        </p>
      </div>
    </section>
  );
};

export default PlatformSection;
