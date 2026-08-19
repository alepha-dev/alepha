import AdminSection from "./home/AdminSection.tsx";
import AgentSection from "./home/AgentSection.tsx";
import FoundationSection from "./home/FoundationSection.tsx";
import HeroSection from "./home/HeroSection.tsx";
import ParticleNetwork from "./home/ParticleNetwork.tsx";
import PlatformSection from "./home/PlatformSection.tsx";
import ProofSection from "./home/ProofSection.tsx";
import RuntimeSection from "./home/RuntimeSection.tsx";
import SeamSection from "./home/SeamSection.tsx";
import StackSection from "./home/StackSection.tsx";
import SwapSection from "./home/SwapSection.tsx";
import StatusBar from "./layout/StatusBar.tsx";

const Home = () => {
  return (
    <div className="terminal-page grid-bg home-snap">
      {/* 3D Particle Network Background */}
      <ParticleNetwork />

      {/* Main Content */}
      <div className="flex flex-col relative" style={{ paddingBottom: 24 }}>
        {/*
          Backgrounds alternate strictly from here down: the hero is plain, then
          every even block is `home-section-alt` and every odd block is plain.
          Adding a block means re-checking its neighbours, which is what put two
          plain sections back to back once already.
        */}
        {/* 1 — the ecosystem, generically (plain) */}
        <HeroSection />
        {/* 2 — one definition, both sides (alt) */}
        <SeamSection />
        {/* 3 — same code, three targets (plain) */}
        <RuntimeSection />
        {/* 4 — one dependency (alt) */}
        <StackSection />
        {/* 5 — what it is built on (plain) */}
        <FoundationSection />
        {/* 6 — written for an agent (alt) */}
        <AgentSection />
        {/* 7 — substitution and testing (plain) */}
        <SwapSection />
        {/* 8 — the admin panel you did not build (alt) */}
        <AdminSection />
        {/* 9 — one command to production (plain) */}
        <PlatformSection />
        {/* 10 — conclusion (alt) */}
        <ProofSection />
      </div>

      {/* Status Bar (docs footer) */}
      <div
        style={{ position: "fixed", bottom: 0, left: 0, right: 0, zIndex: 100 }}
      >
        <StatusBar />
      </div>

      {/* Bounce animation for scroll button */}
      <style>{`
        @keyframes bounceDown {
          0%, 20%, 50%, 80%, 100% {
            transform: translateY(0);
          }
          40% {
            transform: translateY(8px);
          }
          60% {
            transform: translateY(4px);
          }
        }
        .scroll-down-btn:hover {
          color: var(--color-accent) !important;
        }
        .scroll-down-btn:hover svg {
          color: var(--color-accent);
        }
      `}</style>
    </div>
  );
};

export default Home;
