# 本地开发数据备份与恢复

Docker 命名卷用于持久化，不等于备份。本项目的完整开发备份包含 PostgreSQL 自定义格式转储、上传文件归档、版本清单和 SHA-256 校验和。

## 创建备份

先确认 `db` 服务正在运行，然后在仓库根目录执行：

```bash
./scripts/backup-dev.sh
```

默认输出到 `backups/<UTC 时间>/`。也可以指定仓库之外的目录：

```bash
./scripts/backup-dev.sh /Volumes/FamilyBackup/family-app
```

每次备份包含：

- `database.dump`：`pg_dump` 自定义格式数据库转储。
- `uploads.tar.gz`：菜谱图片和其他上传附件。
- `manifest.txt`：备份时间、Git 提交和迁移版本。
- `checksums.sha256`：上述文件的完整性校验。

至少保留一份不在当前电脑上的副本。备份目录可能包含家庭隐私数据，不应提交 Git 或上传公共网盘。

## 计划备份与运行状态

家庭管理员可从“系统备份”配置每天或每周完整备份、保留天数与份数、容量告警阈值，以及每月隔离恢复演练。API 只保存策略和任务状态；独立 `backup-worker` 容器连接数据库、只读访问上传卷并写入专用备份目录，不挂载 Docker socket。

开发环境启动 worker 时不要重新运行 seed：

```bash
/Applications/Docker.app/Contents/Resources/bin/docker compose \
  -f docker-compose.dev.yml up -d --no-deps backup-worker
```

开发环境的受管备份默认写入 `backups-managed/`。生产环境由 `FAMILY_APP_BACKUP_ROOT` 指定宿主机目录，默认是 `backups-production-managed/`。保留策略只清理受管目录中由同一家庭策略创建且通过 UUID 路径验证的旧备份，运行历史不会删除。容量进入警告或严重状态时，家庭管理员会收到系统通知。

自动恢复演练依次验证 SHA-256、恢复到随机临时数据库、执行待运行迁移、核对家庭和迁移数量、解压附件到临时目录，并在成功或失败后清理临时数据库和文件。活动数据库与上传卷始终保持不变。

## 恢复演练

恢复脚本只允许恢复到一个不存在的新数据库，拒绝覆盖当前使用的 `family_app`。上传文件会解压到预览目录，不会覆盖当前上传卷。

```bash
./scripts/restore-dev.sh \
  backups/<备份时间> \
  family_app_restore_test
```

脚本依次执行校验和检查、创建新数据库、`pg_restore`、运行待执行迁移、恢复附件到 `restore-preview/`，最后输出迁移数量。若目标数据库已存在，脚本会停止。

恢复后还应核对关键表行数，并确认实体结构没有漂移：

```bash
DB_NAME=family_app_restore_test npx pnpm --filter api test:schema
```

验证完成后，可显式删除这次演练创建的数据库和预览目录；不要把删除命令指向当前使用的数据库或其他备份目录。

## 生产恢复演练

生产恢复脚本只允许恢复到不存在的新数据库，拒绝活动生产数据库，并将附件解压到独立预览目录。它不会切换生产连接或覆盖上传卷：

```bash
FAMILY_APP_PROD_ENV=deploy/.env.production \
  ./scripts/restore-prod.sh \
  backups-production-managed/<家庭 UUID>/<运行 UUID> \
  family_app_restore_202608
```

生产切换仍是明确的停机运维操作：应先核对恢复库和附件，另做一次最新备份，再通过受控部署修改数据库与上传卷指向。不要在脚本外直接向活动库执行 `pg_restore`。

数据库备份包含加密后的集成凭据，但不包含 `JWT_SECRET`、`INTEGRATION_SECRET_KEY`、数据库密码或其他 secret 文件。灾难恢复前必须从独立受保护位置取得相同的加密主密钥；不要把这些密钥放入备份目录、Git、日志或验收文档。

## 迁移命令

API 和种子任务启动时会自动运行待执行迁移。需要单独检查或运行时：

```bash
npx pnpm --filter api migration:show
npx pnpm --filter api migration:run
```

`migration:show` 只显示状态，不会自动执行迁移。回退迁移可能破坏多家庭数据，只应在已验证备份且明确了解影响时使用。

旧 PIN 迁入账号密码哈希后仍无法还原明文。向不支持独立账号的旧版本回退会破坏账号与成员的长期边界，只能在已验证备份上演练，并应准备让成员重新设置密码。
