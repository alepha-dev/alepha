# The agent image's stub (#Q3999, #Q3997): the shape of ghcr.io/alepha-dev/lore-agent
# (a non-root user 1000, /work and /cache it owns, claude and git on its PATH)
# with a fake claude and a fake git, for Bay's container runner tests. Never
# published.
FROM busybox:1.37
RUN mkdir -p /work /cache && chown 1000:1000 /work /cache
COPY claude git /usr/local/bin/
RUN chmod 755 /usr/local/bin/claude /usr/local/bin/git
USER 1000:1000
