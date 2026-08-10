# syntax=docker/dockerfile:1.7
#
# OpenCode headless server image.
#
# Builds the standalone opencode binary (with embedded web UI) from source using
# Bun's compiler, then ships it on a slim Alpine base. The entrypoint runs
# `opencode serve` against 0.0.0.0 so the container's port mapping is the only
# network decision you need to make.
#
# Build context MUST be the repository root (the monorepo), e.g.:
#   docker build -t opencode -f infra/deploy/Dockerfile .

ARG BUN_VERSION=1.3.14
ARG NODE_VERSION=22

# --------------------------------------------------------------------------- #
# Builder: install deps + compile the opencode binary with embedded web UI.     #
# --------------------------------------------------------------------------- #
FROM oven/bun:${BUN_VERSION}-alpine AS build

# Native build deps: ripgrep is pulled at runtime, but a few modules need build
# tooling (python/make/g++ for tree-sitter, etc.) only used during install.
RUN apk add --no-cache python3 make g++ git

WORKDIR /repo

# Copy manifests first for a cacheable dependency-install layer.
COPY bun.lock bunfig.toml turbo.json package.json ./
COPY tsconfig.json ./
COPY patches/ ./patches/
COPY packages/ ./packages/

# Install the whole workspace. `--frozen-lockfile` keeps the build reproducible
# but you can drop it for patch-level pins. node-pty and tree-sitter need the
# trustedDependencies entry in package.json to build.
RUN bun install --frozen-lockfile

# Build the web app (the embedded UI bundle imports from ./packages/app/dist).
# Skip embedding if you only want the API; here we embed so the container is one
# self-contained binary serving both the API and the web UI.
RUN bun run --cwd packages/app build

# Compile the standalone opencode binary for this host arch/abi. `--single`
# builds only the current platform; on Alpine that yields a musl binary.
WORKDIR /repo/packages/opencode
RUN bun run build -- --single --skip-install

# --------------------------------------------------------------------------- #
# Runtime: slim Alpine + the compiled binary + ripgrep for grep tool.        #
# --------------------------------------------------------------------------- #
FROM alpine:3.20 AS runtime

# ripgrep: required by opencode's built-in grep tool.
# libstdc++: the compiled binary links against it (musl variant).
# ca-certificates: required for outbound HTTPS to LLM providers.
# tini: a real PID 1 that reaps zombies and forwards signals to the Bun runtime
#       (matters for clean PTY/session teardown when the server stops).
RUN apk add --no-cache ripgrep libstdc++ libgcc ca-certificates tini

# Non-root user. Home is set so opencode writes its config/cache/data under
# /home/opencode/.local/share/opencode (XDG defaults) which we bind to a volume.
RUN addgroup -S -g 1000 opencode \
 && adduser -S -D -H -G opencode -u 1000 -h /home/opencode opencode

# Workspace dir is where the agent operates. Bind a volume here so sessions and
# git repos persist across image rebuilds.
RUN mkdir -p /workspace /home/opencode/.local/share/opencode \
 && chown -R opencode:opencode /workspace /home/opencode

# Copy the compiled binary from the build stage. The build outputs to
# dist/<name>/bin/opencode; resolve with a glob fallback to be resilient.
COPY --from=build /repo/packages/opencode/dist/opencode-linux-*/bin/opencode /usr/local/bin/opencode

# Smoke test that the binary actually runs in this base image.
RUN opencode --version

ENV OPENCODE_HOME=/home/opencode/.local/share/opencode \
    OPENCODE_CONFIG_DIR=/home/opencode/.config/opencode

USER opencode
WORKDIR /workspace
VOLUME ["/workspace", "/home/opencode/.local/share/opencode", "/home/opencode/.config/opencode"]

EXPOSE 4096

# Healthcheck hits the OpenAPI doc endpoint, which is unauthenticated and cheap.
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD opencode api --url http://127.0.0.1:${PORT:-4096} session list >/dev/null 2>&1 || exit 1

# tini -> opencode serve. Hostname 0.0.0.0 so the port is reachable through
# Docker's forwarding. Port is overridable via PORT env.
ENTRYPOINT ["/sbin/tini", "--", "opencode", "serve", "--hostname", "0.0.0.0", "--port", "4096"]
