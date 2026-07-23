# Stage 1: Build — run on host platform, cross-compile to target
FROM --platform=$BUILDPLATFORM golang:1.26-alpine AS builder

ARG TARGETOS
ARG TARGETARCH

WORKDIR /build

COPY go.mod go.sum ./
RUN --mount=type=cache,target=/go/pkg/mod go mod download

COPY . .
RUN --mount=type=cache,target=/go/pkg/mod --mount=type=cache,target=/root/.cache/go-build \
    CGO_ENABLED=0 GOOS=$TARGETOS GOARCH=$TARGETARCH go build -o lyftr-mcp .

# Stage 2: Runtime
FROM alpine:3.19

RUN apk add --no-cache ca-certificates

WORKDIR /app
COPY --from=builder /build/lyftr-mcp .

# Only meaningful when MCP_TRANSPORT=http — the stdio mode this image is not
# used for (stdio clients run the binary locally, not in this container).
EXPOSE 8811

ENTRYPOINT ["/app/lyftr-mcp"]
