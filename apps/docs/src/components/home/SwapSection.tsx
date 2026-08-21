import { snippets } from "../../config/docs.ts";
import CodePane from "./CodePane.tsx";
import DocLink from "./DocLink.tsx";

/**
 * The test on the left, what the container did on the right.
 *
 * A timeline rather than another panel grid: the point of `travel()` is that
 * time moves without the test waiting, and that is hard to say and easy to
 * draw. The clock marks are the test's own, so the right column is the left
 * column executed.
 *
 * Every symbol here is real: `MemoryEmailProvider.records` exists, `travel`
 * takes `[n, unit]`, and there are 14 `Memory*Provider` classes in
 * `packages/alepha/src`.
 */
const TIMELINE = [
  {
    at: "09:00",
    label: "alepha.start()",
    body: "The container resolves. Every provider is the real one, except the ones you swapped.",
  },
  {
    at: "09:00",
    label: "travel([1, 'day'])",
    body: "The clock moves a day forward. The test does not wait, and nothing sleeps.",
    accent: true,
  },
  {
    at: "next day",
    label: "$job fires",
    body: "Cron is anchored to the same clock, so the scheduled job runs during the jump.",
  },
  {
    at: "next day",
    label: "records: 1",
    body: "The mail never left the process. It is a row in an array you can assert on.",
  },
];

const SwapSection = () => {
  return (
    <section id="swap" className="home-block home-section">
      <div className="container-wide container">
        <div className="section-head">
          <h2 className="section-title">Swap anything. Even time.</h2>
          <p className="section-sub">
            Nothing in the framework is sealed. Every provider is a class in the
            container, so a test replaces the one it does not want and leaves
            the rest running for real.
          </p>
        </div>

        <div className="swap-layout">
          <div className="swap-code">
            {/* Same build-time highlighter as the seam block, rather than a
                hand-rolled `pre`: the snippet lives in scripts/snippets.ts and
                is rendered by gen-tree into `.gen`. */}
            <CodePane html={snippets.test} />
            <p className="swap-code-note">
              One line replaced the mail server. There is no module registry to
              patch, no hoisting order to get right, and nothing to reset
              between tests: the container is new each time. No vi.mock.
            </p>
          </div>

          <ol className="swap-timeline">
            {TIMELINE.map((it) => (
              <li
                className={`swap-step${it.accent ? " is-accent" : ""}`}
                key={it.label}
              >
                <span className="swap-step-at">{it.at}</span>
                <span className="swap-step-dot" aria-hidden="true" />
                <div className="swap-step-text">
                  <code className="swap-step-label">{it.label}</code>
                  <p className="swap-step-body">{it.body}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>

        <p className="swap-footnote">
          Fourteen in-memory providers ship with the framework, covering the{" "}
          <DocLink to="packages-alepha-system">filesystem</DocLink>, the{" "}
          <DocLink to="packages-alepha-system">shell</DocLink>,{" "}
          <DocLink to="packages-alepha-queue-core">queues</DocLink>,{" "}
          <DocLink to="packages-alepha-topic-core">topics</DocLink>,{" "}
          <DocLink to="packages-alepha-lock-core">locks</DocLink>,{" "}
          <DocLink to="packages-alepha-email-core">mail</DocLink>,{" "}
          <DocLink to="packages-alepha-sms">SMS</DocLink>,{" "}
          <DocLink to="packages-alepha-api-payments">payments</DocLink>,{" "}
          <DocLink to="packages-alepha-captcha">captchas</DocLink>,{" "}
          <DocLink to="packages-alepha-bucket">file storage</DocLink> and{" "}
          <DocLink to="packages-alepha-datetime">the clock</DocLink>. Anything
          they do not cover is still a class, so it is still{" "}
          <DocLink to="guides-testing-unit-tests">substitutable</DocLink>.
        </p>
      </div>
    </section>
  );
};

export default SwapSection;
