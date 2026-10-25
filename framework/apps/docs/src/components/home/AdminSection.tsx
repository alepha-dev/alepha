import {
  IconChevronLeft,
  IconChevronRight,
  IconMaximize,
  IconX,
} from "@tabler/icons-react";
import { Link } from "alepha/react/router";
import { useCallback, useEffect, useState } from "react";

import Dialog from "../layout/Dialog.tsx";
import AdminShot from "./AdminShot.tsx";
import DocLink from "./DocLink.tsx";

const SHOTS = [
  {
    base: "/admin/users",
    label: "Users",
    caption:
      "Every account with its roles and status, searchable, filterable and paginated.",
  },
  {
    base: "/admin/user-detail",
    label: "User detail",
    caption:
      "Profile, security, sessions and that user's own audit trail, on four tabs.",
  },
  {
    base: "/admin/jobs",
    label: "Jobs",
    caption:
      "Every $job across every module: its schedule, last run, and success and error counts.",
  },
  {
    base: "/admin/parameters",
    label: "Parameters",
    caption:
      "Runtime configuration edited from the browser, versioned, with history and a factory reset.",
  },
  {
    base: "/admin/account",
    label: "Account",
    caption:
      "The self-service half: avatar, profile, password, sessions, API keys and connected apps.",
  },
  {
    base: "/admin/login",
    label: "Sign in",
    caption:
      "Sign-in, registration and password reset, generated from the realm settings.",
  },
];

const AdminSection = () => {
  const [index, setIndex] = useState(0);
  const [zoomed, setZoomed] = useState(false);

  const go = useCallback((next: number) => {
    setIndex((next + SHOTS.length) % SHOTS.length);
  }, []);

  // Arrow keys drive the lightbox. Dialog already owns Escape.
  useEffect(() => {
    if (!zoomed) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") go(index + 1);
      if (e.key === "ArrowLeft") go(index - 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [zoomed, index, go]);

  const shot = SHOTS[index];

  return (
    <section id="admin" className="home-block home-section home-section-alt">
      <div className="container-wide container">
        <div className="admin-layout">
          {/* Left: the pitch and the command */}
          <div className="admin-left">
            <h2 className="section-title">An admin panel you did not build</h2>
            <p className="admin-lead">
              <Link href="/docs/cli-commands-init#the-saas-preset">
                One flag
              </Link>{" "}
              on <code>init</code> and this is already there. Turn on a module
              and its screens appear on their own:{" "}
              <DocLink to="packages-alepha-api-users">users</DocLink>,{" "}
              <DocLink to="guides-server-authentication">sessions</DocLink>,{" "}
              <DocLink to="packages-alepha-api-keys">API keys</DocLink>,{" "}
              <DocLink to="packages-alepha-api-jobs">jobs</DocLink>,{" "}
              <DocLink to="packages-alepha-api-notifications">
                notifications
              </DocLink>
              , <DocLink to="packages-alepha-api-audits">audits</DocLink>,{" "}
              <DocLink to="packages-alepha-api-files">files</DocLink>,{" "}
              <DocLink to="packages-alepha-api-parameters">parameters</DocLink>{" "}
              and <DocLink to="packages-alepha-api-payments">payments</DocLink>.
            </p>
            <p className="admin-lead">
              Not a template you fork and then maintain, but modules that keep
              getting updates with the framework.
            </p>
          </div>

          {/* Right: segmented control + thumbnail */}
          <div className="admin-right">
            <div
              className="admin-tabs"
              role="tablist"
              aria-label="Admin screens"
            >
              {SHOTS.map((it, i) => (
                <button
                  key={it.base}
                  type="button"
                  role="tab"
                  aria-selected={i === index}
                  onClick={() => setIndex(i)}
                  className={`admin-tab${i === index ? " is-active" : ""}`}
                >
                  {it.label}
                </button>
              ))}
            </div>

            <button
              type="button"
              className="admin-thumb"
              onClick={() => setZoomed(true)}
              aria-label={`Open ${shot.label} full size`}
            >
              <AdminShot base={shot.base} label={shot.label} />
              <span className="admin-thumb-zoom" aria-hidden="true">
                <IconMaximize size={16} />
              </span>
            </button>

            <p className="admin-caption">{shot.caption}</p>
          </div>
        </div>
      </div>

      {/* Lightbox */}
      <Dialog
        open={zoomed}
        onClose={() => setZoomed(false)}
        center
        overlayPadding="24px"
        ariaLabel={`${shot.label}, full size`}
        className="admin-lightbox"
      >
        <div className="admin-lightbox-head">
          <span className="admin-lightbox-label">{shot.label}</span>
          <span className="admin-lightbox-count">
            {index + 1} / {SHOTS.length}
          </span>
          <button
            type="button"
            className="admin-close"
            onClick={() => setZoomed(false)}
            aria-label="Close"
          >
            <IconX size={18} />
          </button>
        </div>

        <div className="admin-lightbox-frame">
          <button
            type="button"
            className="admin-nav admin-nav-prev"
            onClick={() => go(index - 1)}
            aria-label="Previous screen"
          >
            <IconChevronLeft size={20} />
          </button>

          <AdminShot base={shot.base} label={shot.label} />

          <button
            type="button"
            className="admin-nav admin-nav-next"
            onClick={() => go(index + 1)}
            aria-label="Next screen"
          >
            <IconChevronRight size={20} />
          </button>
        </div>

        <p className="admin-lightbox-caption">{shot.caption}</p>
      </Dialog>
    </section>
  );
};

export default AdminSection;
