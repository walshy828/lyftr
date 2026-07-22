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

# Persistent data directory (mount a volume here)
RUN mkdir -p /app/data

EXPOSE 3000

ENTRYPOINT ["/app/lyftr-api"]
