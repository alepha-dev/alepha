import { IconBrandGithub, IconBrandNpm } from "@tabler/icons-react";

import CopyCommand from "./CopyCommand.tsx";

const ProofSection = () => {
  return (
    <section id="more" className="home-block home-section home-section-alt">
      <div className="proof-cta container">
        <h2 className="section-title">Try it in one command</h2>

        <CopyCommand command="npx alepha@latest init my-app" />

        <p className="proof-license">
          100% open source, 100% MIT. The framework, Lore and Bay all live in
          one public repository and ship on the same version, so every release
          is proved by applications that use it. Nothing here is a paid tier of
          something else.
        </p>

        <div className="proof-links flex gap-6">
          <a
            href="https://github.com/feunard/alepha"
            target="_blank"
            rel="noopener noreferrer"
            className="footer-link flex items-center gap-2"
          >
            <IconBrandGithub size={18} aria-hidden="true" />
            <span>GitHub</span>
          </a>
          <a
            href="https://www.npmjs.com/package/alepha"
            target="_blank"
            rel="noopener noreferrer"
            className="footer-link flex items-center gap-2"
          >
            <IconBrandNpm size={18} aria-hidden="true" />
            <span>npm</span>
          </a>
        </div>
      </div>
    </section>
  );
};

export default ProofSection;
