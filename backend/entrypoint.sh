#!/bin/sh
# Drop privileges before running the API.
#
# The container starts as root purely so it can fix ownership of /app/data and
# then step down. That step matters because of how bind mounts work on Linux:
# `./data:/app/data` with no host directory present makes the Docker daemon
# create one owned by root, which a non-root process cannot write — the server
# would fail to open its database and crash-loop on a fresh install. Docker
# Desktop on macOS hides this (it remaps ownership), so it only bites on real
# Linux hosts, which is to say in production.
#
# Everything after the exec runs as the unprivileged lyftr user, so a bug in the
# API is not a bug running as uid 0 on a volume mounted from the host.
set -e

if [ "$(id -u)" = "0" ]; then
    # Only touch files that are not already correct: a full recursive chown on
    # every boot would walk the whole database and photo directory for nothing.
    find /app/data ! -user lyftr -exec chown lyftr:lyftr {} + 2>/dev/null || true
    exec su-exec lyftr "$@"
fi

# Already unprivileged (e.g. compose `user:` override, or a read-only rootfs
# setup that pre-owns the volume) — nothing to drop.
exec "$@"
