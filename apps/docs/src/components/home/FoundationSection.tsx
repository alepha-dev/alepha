import { useState } from "react";
import DocLink from "./DocLink.tsx";

/**
 * The foundation, drawn as a stack rather than a card grid.
 *
 * Your app sits on Alepha, Alepha sits on four bricks it did not invent, and
 * all of it sits on whatever runtime you deployed to. Hovering a brick swaps
 * the panel underneath rather than expanding the brick, so nothing reflows.
 */
const BRICKS = [
  {
    name: "Zod",
    logo: "/brand/zod.svg",
    role: "The schema",
    body: "One schema, declared once, becomes the database column, the request validation, the OpenAPI document and the React form. Imported as z from alepha, carrying the framework's own defaults and formats.",
  },
  {
    name: "Drizzle",
    logo: "/brand/drizzle.svg",
    role: "The database",
    body: (
      <>
        A proven SQL engine, wrapped completely: you write a typed{" "}
        <code>$entity</code> and read it through a <code>$repository</code>.
        When you need the database itself, <code>sql``</code> is exported too,
        so raw SQL is an escape hatch rather than a rewrite.
      </>
    ),
  },
  {
    name: "React",
    logo: "/brand/react.svg",
    role: "The interface",
    body: "Vanilla React, deliberately. No Server Components, no client/server directives, no dialect to learn. Plain components with streaming SSR, routing and forms around them.",
  },
  {
    name: "Vite",
    logo: "/brand/vite.svg",
    role: "The build",
    body: "Alepha brings its own build command, so there is no config to write and no babel step. It is Vite underneath, so every Vite plugin still works.",
  },
];

const FoundationSection = () => {
  const [active, setActive] = useState<number | null>(null);
  const brick = active === null ? null : BRICKS[active];

  return (
    <section id="foundation" className="home-block home-section">
      <div className="container">
        <div className="section-head">
          <h2 className="section-title">Built on what already works</h2>
          <p className="section-sub">
            Alepha does not reinvent the load-bearing parts. It rewrites
            everything between them, so the pieces you already trust fit
            together with nothing left to wire.
          </p>
        </div>

        <div className="stack-diagram">
          {/* What you write */}
          <div className="slab slab-app">
            <span className="slab-label">Your app</span>
            <span className="slab-note">
              <DocLink to="reference-primitives-$entity">$entity</DocLink> ·{" "}
              <DocLink to="reference-primitives-$action">$action</DocLink> ·{" "}
              <DocLink to="reference-primitives-$page">$page</DocLink> ·{" "}
              <DocLink to="reference-primitives-$job">$job</DocLink>
            </span>
          </div>

          {/* The framework */}
          <div className="slab slab-alepha">
            <span className="slab-label">
              {/* Decorative: the word beside it already names the slab, so an
                  alt here would have a screen reader say "Alepha Alepha". */}
              <img
                src="/logo.svg"
                alt=""
                aria-hidden="true"
                className="slab-logo"
                width={20}
                height={20}
                loading="lazy"
              />
              Alepha
            </span>
            <span className="slab-note">
              <DocLink to="packages-alepha-server-core">server</DocLink> ·{" "}
              <DocLink to="packages-alepha-orm-core">orm</DocLink> ·{" "}
              <DocLink to="guides-server-authentication">auth</DocLink> ·{" "}
              <DocLink to="packages-alepha-queue-core">queues</DocLink> ·{" "}
              <DocLink to="guides-server-background-jobs">cron</DocLink> ·{" "}
              <DocLink to="guides-persistence-storage">storage</DocLink> ·{" "}
              <DocLink to="guides-frontend-react">SSR</DocLink>
            </span>
          </div>

          {/* The bricks it rests on */}
          <div className="brick-row">
            {BRICKS.map((it, i) => (
              <button
                type="button"
                key={it.name}
                className={`brick${active === i ? " is-active" : ""}`}
                onMouseEnter={() => setActive(i)}
                onMouseLeave={() => setActive(null)}
                onFocus={() => setActive(i)}
                onBlur={() => setActive(null)}
                aria-describedby="foundation-detail"
              >
                <img
                  src={it.logo}
                  alt=""
                  aria-hidden="true"
                  className="brick-logo"
                  width={26}
                  height={26}
                  loading="lazy"
                />
                <span className="brick-name">{it.name}</span>
                <span className="brick-role">{it.role}</span>
              </button>
            ))}
          </div>

          {/* The ground */}
          <div className="slab slab-runtime">
            <span className="slab-label">The runtime</span>
            <span className="slab-note">
              node:http · Bun.serve · Workers fetch
            </span>
          </div>
        </div>

        {/* Hover detail. Fixed height so the stack never reflows. */}
        <div className="foundation-detail" id="foundation-detail">
          {brick ? (
            <p className="foundation-detail-body" key={brick.name}>
              <strong>{brick.name}</strong> {brick.body}
            </p>
          ) : (
            <p className="foundation-detail-body is-idle">
              There is no Express or Fastify in the stack. The HTTP server is
              whatever the runtime already provides, and Alepha picks the one
              that matches where you deployed. Hover a brick to see what it does
              here.
            </p>
          )}
        </div>
      </div>
    </section>
  );
};

export default FoundationSection;
