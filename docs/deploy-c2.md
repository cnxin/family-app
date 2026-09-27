# C2 部署：在 NAS 上从 main 升级

> 给在 NAS 上动手的人。命令都在仓库根目录执行。升级、回滚情形 A 和 B、升级后三处确认，已在本机独立演练栈上从旧 main `2127c70` 实际跑过（见文末「演练记录」）；情形 C 里单独换回 web 的命令没有单独演练。
> 应用代码不在这里改；compose 与脚本见 `docker-compose.prod.yml`、`scripts/upgrade-prod.sh`、`scripts/backup-prod.sh`、`scripts/restore-prod.sh`。

## 0. 前提

| 项目 | 要求 |
| --- | --- |
| 部署方式 | NAS 上是本仓库的 git 检出，镜像在 NAS 本地 `docker compose build`（没有镜像仓库） |
| 当前运行提交 | 【King 稍后填：`git -C <仓库目录> rev-parse --short HEAD` 的结果】 |
| Docker Compose | **≥ 2.20**（`docker compose version`）。升级脚本用 `up --wait --wait-timeout`，旧版本没有这两个参数 |
| 配置 | `deploy/.env.production` 与 `deploy/secrets/*` 已存在；**`TZ=Asia/Shanghai` 写明在 `.env.production` 里**（示例文件已有这一行，别删） |
| 仓库状态 | `git status` 干净。升级脚本发现有未提交改动会直接停 |
| 磁盘 | 备份目录（默认 `backups-production/`）放得下一份数据库导出 + 附件压缩包 |

## 1. 这次升级会变什么

- **前端是新客户端**：旧的 Expo 客户端已在 H1 删除，家里人的旧书签会被跳到同名的新地址。
- **两个新迁移**，API 启动时自动执行（`migrationsRun: true`，全部迁移在一个事务里，失败整体回滚，API 不会起来）：
  - `AddHouseholdModuleOverrides1785232400000`：新表 `household_module_overrides`（家里页的开启 / 收起）。
  - `AddMaintenancePerformedOn1785232500000`：维护记录加 `performedOn`（纯日期，NOT NULL），历史记录按各家庭时区从 `performedAt` 回填。
- **backup-worker 补上 `TZ`**：之前四个服务里只有它没设。业务上的「今天」看的是家庭设置里的时区，`TZ` 管的是容器系统时间和日志。

## 2. 升级

**第一次（NAS 上的旧代码里还没有升级脚本）**：先手动拉代码，再让脚本跳过拉取这一步。

```bash
git status
git pull --ff-only
./scripts/upgrade-prod.sh --no-pull
```

**以后**：

```bash
./scripts/upgrade-prod.sh
```

脚本按顺序做下面几步，**任一步失败立即停下，不自动回滚**，并打印失败的步骤、升级前提交、回滚镜像标签和备份目录：

1. 检查工作区干净、db / api / web / backup-worker 都在运行；
2. 给正在运行的三个镜像打回滚标签 `family-app-<服务>:prod-before-<日期-时间>`；
3. `backup-prod.sh` 备份数据库和附件；
4. `git pull --ff-only`（`--no-pull` 时跳过）；
5. `compose build`；
6. `compose up -d --wait`（API 启动时执行迁移；起不来会在超时后报错并打出 API 日志）；
7. 逐个等 db / api / web 变成 healthy，确认 backup-worker 在运行，打印最近三个迁移。

**把脚本最后打印的「回滚镜像标签」和「升级前备份」记下来**，回滚要用。`--no-pull` 时备份清单里的 `git_commit` 已经是新代码的提交（备份在手动拉代码之后做），升级前的提交以脚本打印的值（取自 `ORIG_HEAD`）或 `git reflog` 为准。

## 3. 回滚

先认清是哪一种。下面命令里的 `<回滚标签>`、`<升级前提交>`、`<升级前备份>` 都来自升级脚本的输出；`APP_VERSION` 取 `.env.production` 里的值，没设就是 `latest`。

公共的两步（「换回旧镜像」）：

```bash
git reset --hard <升级前提交>
for s in api web backup-worker; do docker tag "family-app-${s}:<回滚标签>" "family-app-${s}:${APP_VERSION:-latest}"; done
```

> 变量一律写成 `${s}` 这种带花括号的形式。zsh 会把 `$s:c…` 当成修饰符，拼出错误的镜像名。

### 情形 A：迁移失败，新 API 起不来 → 只换镜像

**怎么认**：脚本停在「启动」，API 日志里有 `Migration "…" failed`。
**为什么只换镜像就够**：迁移整体在一个事务里，失败后数据库保持升级前的样子。

```bash
# 公共两步之后
docker compose --env-file deploy/.env.production -f docker-compose.prod.yml up -d --no-build --wait --wait-timeout 300
docker compose --env-file deploy/.env.production -f docker-compose.prod.yml exec -T db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "SELECT name FROM app_migrations ORDER BY timestamp DESC LIMIT 1"'
```

最后一条应当仍是 `AddSubscriptionRenewalCycle1785232300000`。**不要恢复备份**，那样只会丢掉升级失败之前的写入。

### 情形 B：升级成功、用了一段时间后要退 → 换镜像 + 恢复升级前备份

**为什么不能只换镜像**：新迁移让 `performedOn` 成了 NOT NULL 且没有默认值，旧代码写维护记录时不给这一列，会直接失败。所以数据库也要回到升级前。
**代价**：升级之后到回滚之间家里人的所有写入都会丢。动手前先告诉家里人。

```bash
./scripts/backup-prod.sh                     # 先把现在（新版）的库留一份底
# 公共两步：git reset + 换回旧镜像标签。必须在恢复之前做：
# restore-prod.sh 用 backup-worker 镜像给恢复出来的库跑迁移，要确保跑的是旧版的迁移
sh scripts/restore-prod.sh <升级前备份> family_app_rollback_<日期>   # 这个脚本在仓库里没有可执行位，用 sh 跑
# 把 deploy/.env.production 里的 POSTGRES_DB 改成 family_app_rollback_<日期>
docker compose --env-file deploy/.env.production -f docker-compose.prod.yml up -d --no-build --wait --wait-timeout 300
```

- `restore-prod.sh` 不覆盖正在用的库：它新建一个库，从备份恢复，校验和、迁移都在新库上做。原来的库留着没删，确认回滚没问题再决定怎么处理。
- 附件卷不动。升级后新传的附件还在卷里，旧库里没有记录引用它们，不影响使用；备份里的附件被解到 `restore-preview/<库名>/uploads` 供核对。

### 情形 C：部分服务起不来 → 看健康检查是谁

| 谁不健康 | 判断 | 怎么办 |
| --- | --- | --- |
| db | 这次升级没换 db 镜像，和升级无关 | 查磁盘、卷和 db 日志；**不要回滚应用镜像** |
| api | 日志里是 `Migration … failed` | 情形 A |
| api | 其他启动错误（密钥、配置） | 修好 `.env.production` / `deploy/secrets` 后 `up -d --wait`；修不好按情形 A |
| web（api 健康） | 数据库已经迁移完，不能退 api | 只换回 web：`docker tag "family-app-web:<回滚标签>" "family-app-web:${APP_VERSION:-latest}"`，再 `up -d --no-build --wait web` |
| backup-worker 不在运行 | 不影响家里人使用 | 看 `logs backup-worker`；修好之前每天手动跑一次 `./scripts/backup-prod.sh` |

## 4. 升级后三处确认

下面的 `dc` 是 `docker compose --env-file deploy/.env.production -f docker-compose.prod.yml` 的简写。

**① 迁移到位**

```bash
dc exec -T db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "SELECT name FROM app_migrations ORDER BY timestamp DESC LIMIT 2; SELECT COUNT(*) FROM maintenance_records WHERE \"performedOn\" IS NULL;"'
```

应看到 `AddMaintenancePerformedOn1785232500000`、`AddHouseholdModuleOverrides1785232400000`，以及 `0`。

**② 时区一致**

```bash
for s in api web backup-worker db; do printf '%s ' "$s"; dc exec -T "$s" sh -c 'echo "${TZ:-未设置}"'; done
dc exec -T api node -e "console.log(Intl.DateTimeFormat().resolvedOptions().timeZone)"
```

四个服务都应是 `Asia/Shanghai`，API 的 Node 也是 `Asia/Shanghai`。再用管理员账号打开「家里 → 家庭设置」，家庭时区是「上海」。

**③ 入口都通**

- 浏览器打开家里地址 `/`：新客户端登录页，登录后是今天页；手机底部是 今天 / 吃饭 / 日程 / 家里 四个 tab。
- `curl -fsS <家里地址>/api/health/ready` 返回 `{"data":{"status":"ok"}}`。
- 管理员打开「家庭设置 → 备份」：备份程序显示在线。家里从没打开过备份页的话，第一次会显示离线（在线状态记在第一次打开时才建的备份策略里），过 15 秒刷新即可。

## 演练记录

在本机起了一套独立的 compose 项目 `family-app-c2r`（端口 18088、独立的卷和镜像标签，不碰演示栈），先用旧 main `2127c70` 起栈，造一个家庭、一件资产、一条上海 00:30 完成的维护记录。结果见下表。

| 日期 | 做了什么 | 结果 |
| --- | --- | --- |
| 2026-09-27 | 修复前升级 | 迁移被「维护记录不可修改」触发器拦下，API 起不来；数据库整体回滚。旧脚本的 `up -d` 在依赖失败后挂起，改用 `--wait`。按情形 A 换回旧镜像后旧版完全恢复 |
| 2026-09-28 | 修复后（`d791c7a` + 本文的脚本）首次升级：手动 `git pull --ff-only` 后 `upgrade-prod.sh --no-pull` | 通过：两个新迁移执行，上海 00:30 完成的维护记录回填为家庭当天（按 UTC 会差一天），四个服务 TZ 均为上海，`/` 新客户端、`/legacy/` 旧客户端、`/api/health/ready` 均通 |
| 2026-09-28 | 在新版上再写一条维护记录后，按情形 B 回滚 | 通过：`restore-prod.sh` 用换回的旧 backup-worker 只跑旧迁移（60 个），切 `POSTGRES_DB` 后旧版健康、旧 API 写维护记录 201；升级后写的那条按预期不在了 |
| 2026-09-28 | 反证：旧镜像直接连升级过的库 | 写维护记录 500（`performedOn` 为空违反 NOT NULL），证实情形 B 不能只换镜像 |

演练栈、卷和演练镜像标签已删除。
