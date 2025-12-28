import {
  FeaturesSection,
  HeroSection,
  MoreSection,
  ParticleNetwork,
} from "./home/index.ts";
import StatusBar from "./layout/StatusBar.tsx";

const Home = () => {
  return (
    <div className="terminal-page grid-bg">
      {/* 3D Particle Network Background */}
      <ParticleNetwork />

      {/* Main Content */}
      <div className="flex flex-col relative" style={{ paddingBottom: 24 }}>
        {/* Block 1: Hero */}
        <HeroSection />

        {/* Block 2: Features */}
        <FeaturesSection />

        {/* Block 3: More */}
        <MoreSection />
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
