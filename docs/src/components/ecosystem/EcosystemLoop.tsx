/**
 * The loop the three products close together, one step each, named after
 * the product that carries it.
 */
const STEPS = [
  {
    verb: "Build",
    product: "Framework",
    text: "Write the app once: schema, API, jobs and pages, typed end to end.",
  },
  {
    verb: "Ship",
    product: "Framework, Lore",
    text: "One command deploys it, from a terminal or from Lore's console.",
  },
  {
    verb: "Run",
    product: "Bay",
    text: "Bay serves it on your machine, with HTTPS, rollback and backups.",
  },
  {
    verb: "Watch",
    product: "Lore",
    text: "Errors, uptime and analytics land in the project that planned it.",
  },
  {
    verb: "Fix",
    product: "Lore",
    text: "An error becomes a quest, and an agent can open the pull request.",
  },
];

const EcosystemLoop = () => {
  return (
    <section id="loop" className="home-block home-section">
      <div className="container-wide container">
        <div className="section-head">
          <h2 className="section-title">Build, Ship, Run, Watch, Fix</h2>
          <p className="section-sub">
            The same loop every team runs, without five vendors in it.
          </p>
        </div>

        <ol className="eco-loop">
          {STEPS.map((step, index) => (
            <li className="eco-loop-step" key={step.verb}>
              <span className="eco-loop-index" aria-hidden="true">
                {String(index + 1).padStart(2, "0")}
              </span>
              <span className="eco-loop-verb">{step.verb}</span>
              <span className="eco-loop-product">{step.product}</span>
              <p className="eco-loop-text">{step.text}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
};

export default EcosystemLoop;
