FROM node:20-alpine AS deps
RUN corepack enable && corepack prepare pnpm@10.24.0 --activate
WORKDIR /app
COPY pnpm-lock.yaml package.json ./
RUN pnpm install --frozen-lockfile

FROM deps AS build
COPY tsconfig.json ./
COPY src src
RUN npx tsc

FROM node:20-alpine AS runtime
RUN corepack enable && corepack prepare pnpm@10.24.0 --activate
RUN addgroup -S app && adduser -S app -G app
WORKDIR /app
COPY --from=build /app /app
USER app
ENV MCP_TRANSPORT=http
ENV MCP_PORT=3000
EXPOSE 3000
CMD ["node", "dist/server/index.js"]
