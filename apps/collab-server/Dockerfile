# ponytail: single stage, whole monorepo, sources run through tsx. A
# multi-stage build with a bundler is the upgrade when image size or
# cold start matters.
FROM node:22-alpine

WORKDIR /app
RUN corepack enable

COPY . .
RUN pnpm install --frozen-lockfile --prod

ENV NODE_ENV=production
EXPOSE 3000
CMD ["pnpm", "--filter", "@tlwb/collab-server", "start"]
