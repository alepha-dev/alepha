import { snippets } from "../../config/docs.ts";
import CodePane from "./CodePane.tsx";

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
          <div className="seam-connector" aria-hidden="true">
            <div className="seam-line" />
            <span className="seam-badge">$client&lt;Api&gt;()</span>
            <div className="seam-line" />
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
