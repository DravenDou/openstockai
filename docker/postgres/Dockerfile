FROM postgres:18.6-alpine3.24
# Security fixes missing from the upstream image at review time.
RUN apk add --no-cache 'nghttp2-libs>=1.70.0-r0' 'zlib>=1.3.2-r1'
