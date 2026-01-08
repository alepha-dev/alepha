import FeaturesSection from "./home/FeaturesSection.tsx";
import HeroSection from "./home/HeroSection.tsx";
import LightPillar from "./home/LightPillar.tsx";
import MoreSection from "./home/MoreSection.tsx";
import ParticleNetwork from "./home/ParticleNetwork.tsx";
import StatusBar from "./layout/StatusBar.tsx";

const Home = () => {
  return (
    <div className="terminal-page grid-bg">
      {/* 3D Particle Network Background */}
      <ParticleNetwork />

      {/* Light Pillar Background */}
      <div
        className="visible-md"
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: "100%",
          height: "100vh",
          pointerEvents: "none",
        }}
      >
        <LightPillar
          bottomColor="#b62525"
          intensity={0.8}
          rotationSpeed={0.05}
          glowAmount={0.001}
          pillarRotation={150}
          pillarHeight={1}
        />
      </div>

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
