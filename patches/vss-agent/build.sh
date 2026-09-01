#!/usr/bin/env bash
# Build the VSS agent image with our customizations applied.
#
# Applies patches/vss-agent/*.patch to the pinned upstream/vss submodule, drops
# in our own (non-NVIDIA) observability plugin, runs NVIDIA's agent build, then
# restores the submodule to its pinned commit — nothing in the submodule is ever
# committed.
#
# Usage:
#   ./build.sh                       # docker buildx build -> vss-agent:latest
#   IMAGE=my/vss-agent:dev ./build.sh
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PATCH_DIR="$REPO_ROOT/patches/vss-agent"
SUBMODULE="$REPO_ROOT/upstream/vss"
SERVICES="$SUBMODULE/services"
AGENT="$SERVICES/agent"
OBS="$AGENT/src/vss_agents/observability"
IMAGE="${IMAGE:-vss-agent:latest}"
PINNED="$(git -C "$SUBMODULE" rev-parse HEAD)"

cleanup() {
    git -C "$SUBMODULE" am --abort 2>/dev/null || true
    git -C "$SUBMODULE" reset --hard "$PINNED" >/dev/null
    git -C "$SUBMODULE" clean -fd >/dev/null
}
trap cleanup EXIT

# 1. Apply our patch to NVIDIA source files (registers the observability plugin
#    as a nat.components entry point in services/agent/pyproject.toml).
git -C "$SUBMODULE" \
    -c user.name="vss-quickstart-build" \
    -c user.email="noreply@localhost" \
    am "$PATCH_DIR"/*.patch

# 2. Drop in our own plugin package. The Dockerfile COPYs src/vss_agents into
#    the image and `uv sync` installs it, so these files ship in the image.
mkdir -p "$OBS"
cp "$PATCH_DIR/observability/__init__.py" \
   "$PATCH_DIR/observability/otel_header_redaction_exporter.py" \
   "$PATCH_DIR/observability/register.py" \
   "$OBS/"

# 3. Build. Context is services/; the Dockerfile COPYs with an agent/ prefix.
docker buildx build --platform linux/amd64 \
    -f agent/docker/Dockerfile -t "$IMAGE" --load "$SERVICES"
