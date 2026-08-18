import { IconArrowRight } from "@tabler/icons-react";
import { Link } from "alepha/react/router";

const PRODUCTS = [
  {
    href: "/lore",
    name: "Lore",
    tagline: "Project management, for agents too.",
    body: "Quests, folios, feedback and crash telemetry. Every surface is readable and writable over MCP, so an agent can orient itself, drive the work and write back what it learned.",
    available: true,
  },
  {
    href: "/bay",
    name: "Bay",
    tagline: "Your own VPS, without the yak shaving.",
    body: "A self-hosted application server. Long-lived processes on a machine you own, with TLS, rollback and process isolation handled for you.",
    available: true,
  },
];

const EcosystemSection = () => {
  return (
    <section id="ecosystem" className="home-block home-section">
      <div className="container">
        <div className="section-head">
          <h2 className="section-title">Not just a framework, an ecosystem</h2>
          <p className="section-sub">
            Real applications built on Alepha, sharing its version number and
            its release. They exist because a framework should be proved by
            something that uses it.
          </p>
        </div>

        <div className="ecosystem-grid">
          {PRODUCTS.map((it) => {
            const inner = (
              <>
                <div className="ecosystem-head">
                  <h3 className="ecosystem-name">{it.name}</h3>
                  {it.available ? (
                    <IconArrowRight
                      size={18}
                      className="ecosystem-arrow"
                      aria-hidden="true"
                    />
                  ) : (
                    <span className="ecosystem-badge">Soon</span>
                  )}
                </div>
                <p className="ecosystem-tagline">{it.tagline}</p>
                <p className="ecosystem-body">{it.body}</p>
              </>
            );

            return it.href ? (
              <Link href={it.href} className="ecosystem-card" key={it.name}>
                {inner}
              </Link>
            ) : (
              <div className="ecosystem-card is-soon" key={it.name}>
                {inner}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
};

export default EcosystemSection;
