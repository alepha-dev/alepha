import { snippets } from "../../config/docs.ts";
import CodePane from "../home/CodePane.tsx";
import EcosystemLane from "./EcosystemLane.tsx";

/**
 * The three products, one lane each, each beside a real artifact: the
 * framework's code, a Lore screen, and Bay's service line and commands.
 */
const EcosystemLanes = () => {
  return (
    <section id="products" className="home-block home-section home-section-alt">
      <div className="container-wide container">
        <div className="section-head">
          <h2 className="section-title">Three products, one version</h2>
          <p className="section-sub">
            Each one stands on its own. Together they take an app from its first
            table to a machine you own, and back to the quest that fixes it.
          </p>
        </div>

        <div className="eco-lanes">
          <EcosystemLane
            name="Framework"
            tagline="Full-stack TypeScript: the database, the API, jobs and React with SSR, in one small surface of typed primitives."
            href="/framework"
            docsHref="/docs/guides-introduction"
          >
            {/* The framework home's own snippet, highlighted at build time. */}
            <CodePane html={snippets.api} />
          </EcosystemLane>

          <EcosystemLane
            name="Lore"
            tagline="Project management for teams and their AI agents: quests, folios, feedback, deploys and app telemetry, all over MCP."
            href="/lore"
            docsHref="/lore/docs/start-introduction"
          >
            {/* Both themes, swapped by `data-theme` like the admin shots. */}
            <div className="eco-shot">
              <img
                src="/screenshots/lore/board-light.png"
                alt="Lore: a project's board of quests"
                className="admin-shot admin-shot-light"
                width={1440}
                height={900}
                loading="lazy"
              />
              <img
                src="/screenshots/lore/board-dark.png"
                alt=""
                aria-hidden="true"
                className="admin-shot admin-shot-dark"
                width={1440}
                height={900}
                loading="lazy"
              />
            </div>
          </EcosystemLane>

          <EcosystemLane
            name="Bay"
            tagline="A self-hosted application server: one Go binary that deploys, proxies, isolates and backs up every app on your VPS."
            href="/bay"
            docsHref="/bay/docs/guides-introduction"
          >
            <div className="deploy-term">
              <span className="deploy-term-head">bay.service</span>
              <pre className="eco-term-body">
                <code>
                  {[
                    "ExecStart=/opt/bay/bin/bay serve \\",
                    "  --root /opt/bay/data \\",
                    "  --base-domain apps.example.com \\",
                    "  --tls --tls-addr :443 \\",
                    "  --control-socket /run/bay/control.sock",
                  ].join("\n")}
                </code>
              </pre>
              <span className="deploy-term-head">terminal</span>
              <pre className="eco-term-body">
                <code>
                  <span className="deploy-prompt">$ </span>
                  {"curl -sSL https://alepha.dev/bay/install.sh | sudo sh\n"}
                  <span className="deploy-prompt">$ </span>
                  {"bay status\n"}
                  <span className="deploy-prompt">$ </span>
                  {"bay logs myapp/production"}
                </code>
              </pre>
            </div>
          </EcosystemLane>
        </div>
      </div>
    </section>
  );
};

export default EcosystemLanes;
