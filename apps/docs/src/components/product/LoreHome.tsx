import { IconExternalLink } from "@tabler/icons-react";

import StatusBar from "../layout/StatusBar.tsx";
import ProductHero from "./ProductHero.tsx";

const LoreHome = () => {
  return (
    <div className="terminal-page grid-bg product-page">
      <ProductHero
        name="Lore."
        tagline="Project management, for agents too."
        lead="An open-source project management app built on Alepha. Quests, folios, feedback and crash telemetry, every one of them readable and writable over MCP."
      >
        {/* A hosted instance to try, the way GitLab runs gitlab.com: it is one
            deployment of the same open-source app you can run yourself. */}
        <p className="product-try">
          Try it on{" "}
          <a
            href="https://lore.alepha.dev"
            target="_blank"
            rel="noopener noreferrer"
            className="product-try-link"
          >
            lore.alepha.dev
            <IconExternalLink size={15} aria-hidden="true" />
          </a>
          , or run your own.
        </p>
      </ProductHero>

      <div
        style={{ position: "fixed", bottom: 0, left: 0, right: 0, zIndex: 100 }}
      >
        <StatusBar />
      </div>
    </div>
  );
};

export default LoreHome;
