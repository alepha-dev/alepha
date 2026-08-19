import { snippets } from "../../config/docs.ts";
import CodePane from "./CodePane.tsx";
import DocLink from "./DocLink.tsx";

const SeamSection = () => {
  return (
    <section id="seam" className="home-block home-section home-section-alt">
      <div className="container">
        <div className="section-head">
          <h2 className="section-title">One definition. Both sides.</h2>
          <p className="section-sub">
            The database column, the HTTP response and the React prop are{" "}
            <strong>the same type</strong>. No codegen step, no generated
            client, no shared types package to keep in sync.
          </p>
        </div>

        <div className="seam-grid">
          <CodePane html={snippets.api} label="Backend" />
          {/* The rules are decorative and hidden individually; the wrapper is
              not, because the badge now holds a real link and a focusable
              element inside `aria-hidden` is reachable by keyboard but
              invisible to a screen reader. */}
          <div className="seam-connector">
            <div className="seam-line" aria-hidden="true" />
            <span className="seam-badge">
              <DocLink to="reference-primitives-$client">
                $client&lt;Api&gt;()
              </DocLink>
            </span>
            <div className="seam-line" aria-hidden="true" />
          </div>
          <CodePane html={snippets.web} label="Frontend" />
        </div>

        <p className="seam-note">
          Rename <code>title</code> in the entity and the React component stops
          compiling. That is the whole contract.
        </p>
      </div>
    </section>
  );
};

export default SeamSection;
