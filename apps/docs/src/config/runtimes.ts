import type { Icon } from "@tabler/icons-react";
import {
  IconBrandCloudflare,
  IconBrandDocker,
  IconServer,
} from "@tabler/icons-react";

/**
 * The infrastructure each primitive resolves to, per deployment target.
 *
 * The point of the home page switcher is that the left column never changes.
 * Only the right column does, and it changes at build time through export
 * conditions, not through anything the application author writes.
 *
 * Order is deliberate: Cloudflare first because it is the free, zero-config
 * way in; VPS second as the cheap sovereign option; Docker last because it is
 * where the genuinely large systems go.
 */
export interface RuntimeBinding {
  primitive: string;
  impl: string;
}

export interface RuntimeTarget {
  key: string;
  label: string;
  icon: Icon;
  headline: string;
  description: string;
  command: string;
  bindings: RuntimeBinding[];
}

export const runtimeTargets: RuntimeTarget[] = [
  {
    key: "cloudflare",
    label: "Cloudflare",
    icon: IconBrandCloudflare,
    headline: "Free to start, nothing to manage.",
    description:
      "Create a Cloudflare account and your full-stack app is live in seconds. No configuration, no server to keep running, and the database, cache, queues and cron are all Cloudflare's problem rather than yours. It is the easiest way to run an Alepha app, and the one you can stop thinking about.",
    command: "alepha build --target cloudflare",
    bindings: [
      { primitive: "$entity", impl: "D1 / Hyperdrive" },
      { primitive: "$cache", impl: "D1" },
      { primitive: "$job({ cron })", impl: "Cron Triggers" },
      { primitive: "$job.push()", impl: "Cloudflare Queues" },
      { primitive: "$storage", impl: "R2" },
      { primitive: "$topic", impl: "Durable Objects" },
      { primitive: "$email", impl: "Cloudflare Email" },
    ],
  },
  {
    key: "vps",
    label: "VPS",
    icon: IconServer,
    headline: "One cheap box you own.",
    description:
      "Sometimes you just want a small VPS. The build is one folder and one process, so it runs on the cheapest box you can rent: node dist, and it is up. It is also the answer when the data has to stay on hardware you control.",
    command: "alepha build --target bare",
    bindings: [
      { primitive: "$entity", impl: "PostgreSQL / SQLite" },
      { primitive: "$cache", impl: "Memory" },
      { primitive: "$job({ cron })", impl: "In-process scheduler" },
      { primitive: "$job.push()", impl: "In-process worker" },
      { primitive: "$storage", impl: "Local disk" },
      { primitive: "$topic", impl: "In-process bus" },
      { primitive: "$email", impl: "SMTP" },
    ],
  },
  {
    key: "docker",
    label: "Docker",
    icon: IconBrandDocker,
    headline: "Millions of requests an hour.",
    description:
      "When the app is genuinely large, Alepha builds a Docker image and stops there. You bring the Kubernetes cluster and run the image on it. Alepha apps are distributed by design, so cache, locks, pub/sub and job dispatch all coordinate through Redis. The biggest Alepha apps running today are on Kubernetes, on dedicated infrastructure.",
    command: "alepha build --target docker",
    bindings: [
      { primitive: "$entity", impl: "PostgreSQL" },
      { primitive: "$cache", impl: "Redis" },
      { primitive: "$job({ cron })", impl: "Cron + Redis lock" },
      { primitive: "$job.push()", impl: "Redis queue" },
      { primitive: "$storage", impl: "S3" },
      { primitive: "$topic", impl: "Redis pub/sub" },
      { primitive: "$email", impl: "SMTP" },
    ],
  },
];
