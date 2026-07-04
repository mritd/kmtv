# syntax=docker/dockerfile:1.7

# web build
FROM --platform=$BUILDPLATFORM oven/bun:1-alpine AS web-builder

WORKDIR /src/web

COPY web/package.json web/bun.lock ./
RUN --mount=type=cache,target=/root/.bun/install/cache \
  bun install --frozen-lockfile
COPY web/ ./
RUN --mount=type=cache,target=/root/.bun/install/cache \
  bun run build

# server build
FROM --platform=$BUILDPLATFORM golang:1-alpine AS server-builder

RUN apk add --no-cache git

WORKDIR /src/server

ARG TARGETOS
ARG TARGETARCH
ARG GOAMD64=""
ARG VERSION=v0.0.0-dev
ARG GIT_COMMIT=unknown
ARG BUILD_TIME=unknown

COPY server/go.mod server/go.sum ./
RUN --mount=type=cache,target=/go/pkg/mod \
  go mod download
COPY server/ ./
COPY --from=web-builder /src/web/dist ./web/dist
RUN --mount=type=cache,target=/go/pkg/mod \
  --mount=type=cache,target=/root/.cache/go-build \
  CGO_ENABLED=0 \
  GOOS=${TARGETOS} \
  GOARCH=${TARGETARCH} \
  GOAMD64=${GOAMD64} \
  go build -trimpath -ldflags "-w -s \
  -X github.com/mritd/kmtv/internal/version.Version=${VERSION} \
  -X github.com/mritd/kmtv/internal/version.GitCommit=${GIT_COMMIT} \
  -X github.com/mritd/kmtv/internal/version.BuildTime=${BUILD_TIME}" \
  -o /go/bin/kmtv .

# final image
FROM mritd/alpine

COPY --from=server-builder /go/bin/kmtv /usr/local/bin/kmtv

EXPOSE 8080

VOLUME ["/data"]

ENTRYPOINT ["kmtv"]

CMD ["--listen", ":8080", "--db-path", "/data/kmtv.db"]
