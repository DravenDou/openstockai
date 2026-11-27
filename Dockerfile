FROM node:24.22.1-alpine3.24@sha256:06d7adf3e0ef61a13f1d28682726366f97a15aa1888c934d3ecec86c33918b53 AS bootstrap

# Use the audited pnpm archive; npm and its unused dependencies are removed.
ADD --checksum=sha256:33dd0748f27e7916c4f1c8b6943461983e3453b06bbda6312a6280130b4881e5 https://registry.npmjs.org/pnpm/-/pnpm-11.25.0.tgz /tmp/pnpm.tgz
RUN apk add --no-cache 'zlib>=1.3.2-r1' \
    && rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx \
    && mkdir -p /opt/pnpm /app \
    && tar -xzf /tmp/pnpm.tgz -C /opt/pnpm --strip-components=1 \
    && chmod -R a+rX /opt/pnpm \
    && chmod a+x /opt/pnpm/bin/pnpm.cjs \
    && ln -s /opt/pnpm/bin/pnpm.cjs /usr/local/bin/pnpm \
    && rm /tmp/pnpm.tgz \
    && chown node:node /app
WORKDIR /app
USER node

FROM bootstrap AS development
COPY --chown=node:node package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY --chown=node:node patches ./patches
COPY --chown=node:node apps/web/package.json ./apps/web/package.json
COPY --chown=node:node apps/agent/package.json ./apps/agent/package.json
COPY --chown=node:node packages/api-client/package.json ./packages/api-client/package.json
COPY --chown=node:node packages/server/package.json ./packages/server/package.json
RUN pnpm install --frozen-lockfile
COPY --chown=node:node . .
RUN mkdir -p apps/agent/.eve
ENV NEXT_TELEMETRY_DISABLED=1
EXPOSE 3017
CMD ["pnpm", "--filter", "@openstockai/web", "exec", "next", "dev", "--hostname", "0.0.0.0", "--port", "3017"]

# .dockerignore excludes private env files and all host build artifacts.
FROM development AS web-build
RUN pnpm build

FROM development AS agent-build
RUN pnpm agent:build

FROM bootstrap AS web-production
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 HOSTNAME=0.0.0.0 PORT=3017
COPY --from=web-build --chown=node:node /app/apps/web/.next/standalone ./
COPY --from=web-build --chown=node:node /app/apps/web/.next/static ./apps/web/.next/static
EXPOSE 3017
CMD ["node", "apps/web/server.js"]

FROM development AS agent-production
ENV NODE_ENV=production HOST=0.0.0.0 PORT=4273 EVE_TRACES_CONTENT=off
COPY --from=agent-build --chown=node:node /app/apps/agent/.output ./apps/agent/.output
EXPOSE 4273
CMD ["node", "apps/agent/.output/server/index.mjs"]
