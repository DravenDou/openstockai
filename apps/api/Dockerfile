FROM golang:1.27.3-alpine AS build
WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -trimpath -o /api ./cmd/api
FROM alpine:3.23
WORKDIR /app
RUN apk add --no-cache ca-certificates 'zlib>=1.3.2-r1' && adduser -D -u 10001 openstock
COPY --from=build /api /api
COPY --from=build /usr/local/go/lib/time/zoneinfo.zip /app/zoneinfo.zip
ENV ZONEINFO=/app/zoneinfo.zip
COPY db/migrations /app/db/migrations
USER openstock
EXPOSE 8087
ENTRYPOINT ["/api"]
