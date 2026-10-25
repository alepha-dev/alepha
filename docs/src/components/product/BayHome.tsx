import StatusBar from "../layout/StatusBar.tsx";
import ProductHero from "./ProductHero.tsx";

const BayHome = () => {
  return (
    <div className="terminal-page grid-bg product-page">
      <ProductHero
        name="Bay."
        tagline="Your own VPS, without the yak shaving."
        lead="A lightweight self-hosted application server for Alepha apps. Long-lived processes on a machine you own, with TLS, automatic S3 backups and process isolation handled for you. One small Go binary, and nothing else to keep running."
        command="curl -sSL https://alepha.dev/bay/install.sh | sh"
        docsHref="/bay/docs/guides-introduction"
      />

      <div
        style={{ position: "fixed", bottom: 0, left: 0, right: 0, zIndex: 100 }}
      >
        <StatusBar />
      </div>
    </div>
  );
};

export default BayHome;
