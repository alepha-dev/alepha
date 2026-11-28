import { posts } from "../config/blog.ts";
import EcosystemHero from "./ecosystem/EcosystemHero.tsx";
import EcosystemLanes from "./ecosystem/EcosystemLanes.tsx";
import EcosystemLoop from "./ecosystem/EcosystemLoop.tsx";
import EcosystemPosts from "./ecosystem/EcosystemPosts.tsx";
import ParticleNetwork from "./home/ParticleNetwork.tsx";
import ProofSection from "./home/ProofSection.tsx";
import StatusBar from "./layout/StatusBar.tsx";

/**
 * The site's front page, `/`: the three products side by side. The
 * framework's own page, which this was until then, is `/framework`.
 */
const Ecosystem = () => {
  return (
    <div className="terminal-page grid-bg home-snap">
      <ParticleNetwork />

      <div className="relative flex flex-col" style={{ paddingBottom: 24 }}>
        {/* Backgrounds alternate as on the framework's page: the hero plain,
            then alt, plain, alt. The latest posts take the alt band after
            the loop, which puts the closing block on a plain one. */}
        <EcosystemHero />
        <EcosystemLanes />
        <EcosystemLoop />
        <EcosystemPosts />
        <ProofSection alt={posts.length === 0} />
      </div>

      <div
        style={{ position: "fixed", bottom: 0, left: 0, right: 0, zIndex: 100 }}
      >
        <StatusBar />
      </div>
    </div>
  );
};

export default Ecosystem;
