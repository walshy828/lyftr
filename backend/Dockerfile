# Stage 1: Build — run on host platform, cross-compile to target
FROM --platform=$BUILDPLATFORM golang:1.26-alpine AS builder

ARG TARGETOS
ARG TARGETARCH
# Version baked into the binary. CI passes the git tag; defaults to "dev" locally.
ARG VERSION=dev

WORKDIR /build

# Download dependencies first (layer cache). Cache mounts persist the module
# and build cache across builds so a go.sum change doesn't force a full re-download.
COPY go.mod go.sum ./
RUN --mount=type=cache,target=/go/pkg/mod go mod download

# Copy source and build the static binary via the shared build script
# (single source of the version ldflags — see backend/build.sh)
COPY . .
RUN --mount=type=cache,target=/go/pkg/mod --mount=type=cache,target=/root/.cache/go-build \
    CGO_ENABLED=0 GOOS=$TARGETOS GOARCH=$TARGETARCH VERSION=$VERSION sh build.sh

# Stage 2: Runtime
FROM alpine:3.19

# ca-certificates for any outbound TLS calls; wget for healthcheck
RUN apk add --no-cache ca-certificates wget

WORKDIR /app

COPY --from=builder /build/lyftr-api .

# Run as a non-root user. The API needs nothing but its own data directory, so
# a container escape or a file-write bug should not land with uid 0 on a volume
# that is bind-mounted from the host. The fixed uid/gid keeps ownership stable
# across rebuilds so an existing ./data volume stays writable.
RUN addgroup -g 10001 -S lyftr && adduser -u 10001 -S -G lyftr lyftr

# Persistent data directory (mount a volume here), owned by the runtime user.
RUN mkdir -p /app/data && chown -R lyftr:lyftr /app

USER lyftr

EXPOSE 3000

ENTRYPOINT ["/app/lyftr-api"]
