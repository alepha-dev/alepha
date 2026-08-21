import AgentStation from "./AgentStation.tsx";
import DocLink from "./DocLink.tsx";

/**
 * Four panels sharing their borders, read as one object rather than a row of
 * cards. Reading order is by row: what an agent reads, how the CLI answers it,
 * what it writes with, and what stops it being wrong.
 *
 * Counts and output here are real. `PRIMITIVES` is a sample of the 82 `$`
 * exports in `packages/alepha/src`; the log lines are the `pretty` format the
 * CLI switches to on its own under an agent session.
 */
const PRIMITIVES = [
  ["$entity", "the table"],
  ["$repository", "the queries"],
  ["$action", "the endpoint"],
  ["$page", "the route"],
  ["$job", "the cron"],
  ["$storage", "the bucket"],
  ["$client", "the typed call"],
];

const AgentSection = () => {
  return (
    <section id="agents" className="home-block home-section home-section-alt">
      <div className="container container-wide">
        <div className="section-head">
          <h2 className="section-title">
            Built for the thing writing your code
          </h2>
          <p className="section-sub">
            An agent opens this repository and reads the current API instead of
            recalling it: one prefix to write with, one command to check itself,
            and a failure that names the line.
          </p>
        </div>

        <div className="agent-grid">
          <AgentStation
            title="It reads, it does not remember"
            note={
              <>
                <DocLink to="cli-commands-init">
                  <code>alepha init</code>
                </DocLink>{" "}
                writes the file. The index is rebuilt on every deploy and the
                framework's own source ships inside the package, so the model
                reads today's API instead of the one baked into its weights.
              </>
            }
          >
            <div className="agent-file">
              <span className="agent-file-name">AGENTS.md</span>
              {/* Verbatim from the template `alepha init` writes, at
                  cli/core/templates/agentMd.ts. `src` is in the package's
                  `files`, so that path resolves in a real install. */}
              <pre className="agent-file-body">
                {
                  "## Documentation\n\n- Framework source: `node_modules/alepha/src/`\n- Docs: https://alepha.dev/llms.txt"
                }
              </pre>
            </div>
          </AgentStation>

          <AgentStation
            title="It turns itself up"
            note={
              <>
                No flag was passed. <code>CLAUDECODE</code> in the environment
                switches the logs to full trace and streams every sub-process
                live.
              </>
            }
          >
            <pre className="agent-term">
              <span className="agent-term-cmd">$ alepha verify</span>
              {
                "\n[23:41:02] DEBUG CLI <alepha.core.Alepha>: ready OK [0.0ms]\n[23:41:03] INFO  CLI <alepha.cli.Lint>: oxlint + oxfmt OK [1.2s]\n[23:41:06] INFO  CLI <alepha.cli.Types>: tsc OK [3.4s]"
              }
            </pre>
          </AgentStation>

          <AgentStation
            title="One prefix, 82 primitives"
            note={
              <>
                Every capability is a <code>$</code> export with the same shape.
                There is no second convention waiting to be discovered.
              </>
            }
          >
            <div className="agent-complete">
              <div className="agent-complete-input">
                <span className="agent-dollar">$</span>
                <span className="agent-caret" />
              </div>
              <ul className="agent-complete-list">
                {PRIMITIVES.map(([name, role]) => (
                  <li className="agent-complete-item" key={name}>
                    <code className="agent-complete-name">
                      <DocLink to={`reference-primitives-${name}`}>
                        {name}
                      </DocLink>
                    </code>
                    <span className="agent-complete-role">{role}</span>
                  </li>
                ))}
              </ul>
              <div className="agent-complete-more">
                and 75 more, every one of them <code>$</code>
              </div>
            </div>
          </AgentStation>

          <AgentStation
            title="Nothing merges on a guess"
            note={
              <>
                Lint, types, tests and build behind{" "}
                <DocLink to="cli-commands-verify">one command</DocLink>, there
                since the first commit.
              </>
            }
          >
            <pre className="agent-term">
              <span className="agent-term-fail">
                {"src/Api.ts:14:3 - error TS2322"}
              </span>
              {
                "\nType 'string' is not assignable to\ntype 'boolean'.\n\n  14 |   done: \"yes\",\n     |   ~~~~"
              }
            </pre>
          </AgentStation>
        </div>
      </div>
    </section>
  );
};

export default AgentSection;
