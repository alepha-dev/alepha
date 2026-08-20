import AsteriskNote from "./AsteriskNote.tsx";

/**
 * Deliberately real-looking versions rather than `*`.
 *
 * The point of this block is the upgrade, not the install: twenty `^x.y.z`
 * lines is a bump that has to be read, tested and reconciled every time any
 * one of them cuts a release. Chips did not convey that; a package.json does.
 */
const BEFORE = [
  ["@aws-sdk/client-s3", "^3.744.0"],
  ["@trpc/client", "^11.0.0"],
  ["@trpc/server", "^11.0.0"],
  ["better-auth", "^1.2.7"],
  ["bullmq", "^5.34.10"],
  ["drizzle-kit", "^0.30.4"],
  ["drizzle-orm", "^0.39.3"],
  ["eslint", "^9.20.1"],
  ["express", "^4.21.2"],
  ["helmet", "^8.0.0"],
  ["ioredis", "^5.4.2"],
  ["multer", "^1.4.5-lts.1"],
  ["node-cron", "^3.0.3"],
  ["nodemailer", "^6.10.0"],
  ["pino", "^9.6.0"],
  ["prettier", "^3.5.1"],
  ["socket.io", "^4.8.1"],
  ["vite", "^6.1.0"],
  ["vitest", "^3.0.5"],
  ["zod", "^3.24.2"],
];

const AFTER = [["alepha", "^1.0.0"]];

interface DepLinesProps {
  deps: string[][];
}

const DepLines = (props: DepLinesProps) => {
  return (
    <>
      {props.deps.map(([name, version], i) => (
        <div className="pkg-line" key={name}>
          <span className="pkg-indent">{"    "}</span>
          <span className="pkg-key">"{name}"</span>
          <span className="pkg-punct">: </span>
          <span className="pkg-value">"{version}"</span>
          <span className="pkg-punct">
            {i < props.deps.length - 1 ? "," : ""}
          </span>
        </div>
      ))}
    </>
  );
};

const StackSection = () => {
  return (
    <section id="stack" className="home-block home-section home-section-alt">
      <div className="container container-wide">
        <div className="section-head">
          <h2 className="section-title">
            One dependency
            <AsteriskNote>
              Some modules ship separately, such as{" "}
              <span className="asterisk-note-pkg">@alepha/ui</span> and the
              payment providers, but they are installed seamlessly by the Alepha
              CLI and follow the same version number.
            </AsteriskNote>
          </h2>
          <p className="section-sub">
            Twenty packages means twenty changelogs, twenty release cadences and
            every breaking change landing on a different Tuesday. The wiring
            between them is yours to keep working.
          </p>
        </div>

        <div className="stack-compare">
          <div className="pkg-pane pkg-pane-before">
            <div className="pkg-head">
              <span className="pkg-file">package.json</span>
              <span className="pkg-count">20+ dependencies</span>
            </div>
            <pre className="pkg-body">
              <div className="pkg-line">
                <span className="pkg-punct">{"{"}</span>
              </div>
              <div className="pkg-line">
                <span className="pkg-indent">{"  "}</span>
                <span className="pkg-key">"dependencies"</span>
                <span className="pkg-punct">: {"{"}</span>
              </div>
              <DepLines deps={BEFORE} />
              <div className="pkg-line">
                <span className="pkg-indent">{"  "}</span>
                <span className="pkg-punct">{"}"}</span>
              </div>
              <div className="pkg-line">
                <span className="pkg-punct">{"}"}</span>
              </div>
            </pre>
          </div>

          <div className="stack-arrow" aria-hidden="true">
            →
          </div>

          <div className="pkg-pane pkg-pane-after">
            <div className="pkg-head">
              <span className="pkg-file">package.json</span>
              <span className="pkg-count pkg-count-good">1 dependency</span>
            </div>
            <pre className="pkg-body">
              <div className="pkg-line">
                <span className="pkg-punct">{"{"}</span>
              </div>
              <div className="pkg-line">
                <span className="pkg-indent">{"  "}</span>
                <span className="pkg-key">"dependencies"</span>
                <span className="pkg-punct">: {"{"}</span>
              </div>
              <DepLines deps={AFTER} />
              <div className="pkg-line">
                <span className="pkg-indent">{"  "}</span>
                <span className="pkg-punct">{"}"}</span>
              </div>
              <div className="pkg-line">
                <span className="pkg-punct">{"}"}</span>
              </div>
            </pre>
            <div className="pkg-foot">
              <span className="pkg-foot-text">
                One version to bump. One changelog to read.
              </span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};

export default StackSection;
