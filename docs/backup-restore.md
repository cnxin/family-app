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

## 迁移命令

API 和种子任务启动时会自动运行待执行迁移。需要单独检查或运行时：

```bash
npx pnpm --filter api migration:show
npx pnpm --filter api migration:run
```

`migration:show` 只显示状态，不会自动执行迁移。回退迁移可能破坏多家庭数据，只应在已验证备份且明确了解影响时使用。

PIN 哈希迁移不可逆：向旧版本回退时无法恢复原 PIN 明文。需要回退该迁移时，应先验证备份，并准备让成员重新设置 PIN。
