import RuntimeSwitcher from "./RuntimeSwitcher.tsx";

const RuntimeSection = () => {
  return (
    <section id="runtimes" className="home-block home-section">
      <div className="container-wide container">
        <div className="section-head">
          <h2 className="section-title">Same code. Anywhere you run it.</h2>
          <p className="section-sub">
            Not just the HTTP layer. Your database, cache, queues, cron, storage
            and WebSockets all resolve to whatever the platform provides, chosen
            at build time rather than written into your app.
          </p>
        </div>

        <RuntimeSwitcher />
      </div>
    </section>
  );
};

export default RuntimeSection;
