FROM node:22-alpine

RUN npm install --global pnpm@10

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json ./apps/api/package.json
# 工作区包很小，先于 install 复制，postinstall 会顺带构建它们
COPY packages ./packages

RUN pnpm install --frozen-lockfile --filter api...

COPY apps/api ./apps/api

EXPOSE 3100

CMD ["pnpm", "--filter", "api", "start:dev"]
