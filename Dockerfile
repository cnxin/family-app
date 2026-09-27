FROM node:22-alpine

RUN npm install --global pnpm@10

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json ./apps/api/package.json
# 工作区包和构建脚本先于 install 复制：根 postinstall 会执行 scripts/build-packages.mjs 构建 packages/*
COPY packages ./packages
COPY scripts/build-packages.mjs ./scripts/build-packages.mjs

RUN pnpm install --frozen-lockfile --filter api...

COPY apps/api ./apps/api

EXPOSE 3100

CMD ["pnpm", "--filter", "api", "start:dev"]
