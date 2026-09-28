FROM node:22-alpine

RUN npm install --global pnpm@10

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json ./apps/api/package.json
# 工作区包和构建脚本先于 install 复制：根 postinstall 会执行 scripts/build-packages.mjs 构建 packages/*
COPY packages ./packages
COPY scripts/build-packages.mjs ./scripts/build-packages.mjs

# 带上 ./packages/*：根 postinstall 会构建 packages 下每个包，只装 api 依赖时 api-client 等缺 typescript
RUN pnpm install --frozen-lockfile --filter api... --filter "./packages/*"

COPY apps/api ./apps/api

EXPOSE 3100

CMD ["pnpm", "--filter", "api", "start:dev"]
