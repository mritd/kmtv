# syntax=docker/dockerfile:1.7

# web build
FROM oven/bun:1-alpine AS web-builder

WORKDIR /src/web

COPY web/package.json web/bun.lock ./
RUN --mount=type=cache,target=/root/.bun/install/cache \
  bun install --frozen-lockfile
COPY web/ ./
RUN --mount=type=cache,target=/root/.bun/install/cache \
  bun run build

# server build
FROM golang:1-alpine AS server-builder

RUN apk add --no-cache git

WORKDIR /src/server

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
  go install -trimpath -ldflags "-w -s \
  -X github.com/mritd/kmtv/internal/version.Version=${VERSION} \
  -X github.com/mritd/kmtv/internal/version.GitCommit=${GIT_COMMIT} \
  -X github.com/mritd/kmtv/internal/version.BuildTime=${BUILD_TIME}"

# final image
FROM mritd/alpine

COPY --from=server-builder /go/bin/kmtv /usr/local/bin/kmtv

EXPOSE 8080

VOLUME ["/data"]

ENTRYPOINT ["kmtv"]

CMD ["--listen", ":8080", "--db-path", "/data/kmtv.db"]
