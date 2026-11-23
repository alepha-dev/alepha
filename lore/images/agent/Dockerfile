# The agent image (#Q3997): what Bay's container runner runs every agent job in,
# ghcr.io/alepha-dev/lore-agent. Claude Code, git, Node at the repository's
# pinned major and Yarn through Corepack (installed: Node 25 and later ship none), run as the image's non-root user
# (node, uid 1000), with /work and /cache it owns: the job's workspace and its
# dependency cache are volumes mounted there, on a read-only root filesystem.
#
# Pinned: Lore names this image by DIGEST in every job spec, so updating the
# agent is deploying Lore. Claude Code's version is the one package.json and
# package-lock.json beside this file pin, installed with `npm ci`; Dependabot
# bumps it there (#Q4175).
#
# ⚠️ That package-lock.json is the image's own, not a second lockfile of the
# Yarn project: no workspace reaches this folder, and nothing outside this
# image installs from it. It exists because Dependabot reads a version from a
# manifest, never from a `RUN npm install -g pkg@x.y.z`.
#
# Its test variant, with a fake claude, is bay/testdata/agent-stub.
ARG NODE_VERSION=26
FROM node:${NODE_VERSION}-slim

COPY package.json package-lock.json /opt/claude-code/

RUN apt-get update \
  && apt-get install -y --no-install-recommends git ca-certificates openssh-client \
  && rm -rf /var/lib/apt/lists/* \
  && npm ci --prefix /opt/claude-code --omit=dev \
  && ln -s /opt/claude-code/node_modules/.bin/claude /usr/local/bin/claude \
  && npm install -g corepack \
  && npm cache clean --force \
  && corepack enable \
  && mkdir -p /work /cache \
  && chown node:node /work /cache

ENV CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1 \
  DISABLE_AUTOUPDATER=1 \
  COREPACK_ENABLE_DOWNLOAD_PROMPT=0

USER 1000:1000
WORKDIR /work
