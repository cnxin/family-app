# 小管家 · 财务增强计划（Phase K，交接给执行 agent）

> 放进仓库 `docs/finance-plan.md`。硬规矩、SOP、提交格式沿用 `docs/execution-plan.md` §1～§3，不重复。
> 2026-10-04 King 看了 [HomeLedger](https://github.com/sucraft-hub/homeledger)（自托管家庭记账，Express + EJS + SQLite），觉得有几样可以结合进小管家的财务模块。本计划只借它的**产品设计**，不搬代码：技术栈完全不同（我们是 NestJS/TypeORM + React + zod contracts），而且该仓库页面上没有看到 LICENSE 文件，没有明确许可证的代码不能复制。
> 排期：**排在 J1 / J1b 之后。** K0、K1、K3、K4 不依赖助理层，可以在等家庭试用原话（J3 前置条件）的空档做；K2 的截图识别依赖 J4 的云端档配置与脱敏，放到 J4 之后。
> **King 拍板（2026-10-05）**：同意本计划全部决定——分期 K0→K1→K3→K4→（J4 后）K2、只借设计不搬代码、权限口径、导入先预览再入库、单号去重、K2 走云端档。K1 开工前先拿真实的支付宝/微信导出文件核对 §3-K1 的导出路径与列名。
> **2026-10-06 执行顺序调整为 K0 → K3 → K4 → K1（K1 等真实账单样例）。**
> 定位：财务是 18 个插件之一（key `finance`），本计划所有改动都落在财务插件自己的表、服务、页面和 manifest 里，不动内核。

---

## 0. 现状与判断

现有财务模块（`apps/api/src/finance/finance.module.ts` 992 行、`packages/contracts/src/finance.ts`、迁移 `1785232100000-add-family-finance.ts`、`apps/web/src/pages/finance.tsx` + 5 个组件）：

| 已有 | 说明 |
| --- | --- |
| 账户 | 5 种 `cash / bank / alipay / wechat / other`，`openingBalance` + postings 求余额，只支持 CNY（CHECK 约束） |
| 分类 | 平铺一层，`kind` 收入/支出，12 个内置 `systemKey`（餐饮、居家、交通、购物、娱乐、医疗、人情、其他；工资、奖金、报销、其他） |
| 流水 | `expense / income / transfer / reversal`，复式 postings（转账两条、冲销反向复制），`idempotencyKey` 去重，`sourceType` 已能标来源：`manual / agent / shopping_item / asset / media_subscription / finance_transaction` |
| 预算 | 按分类的月预算，`today-attention.rules.ts` 已有超预算留意 |
| 汇总 | `GET /finance/summary`：月收支、账户余额、分类花销、预算执行 |
| 助理 | `propose_finance_transaction` 提案工具；`architecture.md` §3.2 已写了 `finance.record-expense` 意图模板（J3 实现） |
| 联动 | 购物清单「买到」可生成流水（`shopping_item`）；资产续费、观影订阅有来源标记 |

**没有的**（对照 HomeLedger，按对家庭使用的价值排序）：支付宝/微信账单导入、截图记账、周期账单自动入账、信用卡账户（额度/账单日/还款日）、更完整的默认分类。AA 分摊、贷款台账、储蓄目标、多币种、对外 Open API 也没有，但本期不做（见 §1）。

判断：家里人不会一笔一笔手录，**导入是决定财务模块会不会被用起来的那一项**，排第一。截图/自然语言记账是第二入口，和助理层的规则引擎思路一致（HomeLedger 的「没配 API 就退回规则解析」正是我们 10-01 拍板的分层）。

---

## 1. 已拍板 / 不做的事

| 已拍板 | 说明 |
| --- | --- |
| 只借设计不搬代码 | 见文首；实现全部按我们现有的实体/契约/测试规矩来 |
| 权限口径沿用 `architecture.md` §8.6 第 3 条 | 普通成员可记账、看流水；账户、预算、冲销仅管理员。**导入、截图记账都算「记账」**，普通成员可用，但只能导入到已存在的账户 |
| 导入必须预览再入库 | 永远不「上传即入库」；预览里逐行可勾选、可改分类，确认后才写 |
| 去重靠交易单号 | 支付宝/微信导出都带唯一单号；`(householdId, sourceType, externalId)` 唯一索引，重复导入同一文件零副作用 |
| 分类映射会学习 | 用户在预览里改过的「商户 → 分类」记下来，下次自动用；不做云端分类 |
| 周期账单与资产续费、观影订阅不合并 | 三者语义不同（固定支出 / 一件东西的续费 / 一个服务的订阅），只在汇总页把三者的「固定支出」合一行展示 |
| 截图识别走云端第 2 档 | 用 J4 的 BYOK 配置、脱敏与每日上限，不单独再做一套 API 配置；没配云端时入口隐藏 |
| 仍只支持 CNY | CHECK 约束不动 |

| 不做 | 原因 |
| --- | --- |
| AA 分摊 | 一家人共用账本，分摊需求弱；真要分摊用 `actor` 字段按人统计已够 |
| 贷款台账、储蓄目标 | 低频；预算 + 账户余额能覆盖大部分 |
| 多币种与汇率 | 自家没有需求，加上去每个金额口都要带币种 |
| 对外 Open API / 机器人入口 | 助理层的 `propose_*` + MCP 已经是这条路，不另开 token 体系 |
| 本地 OCR（Tesseract） | 中文账单截图识别质量差；本地档若要做用 Ollama 视觉模型，排 J5 之后再议 |
| 二级分类 | 平铺一层 + 补齐到 30 个左右够用；二级分类让记账多一步 |
| 把银行流水 / 信用卡账单也做导入 | 格式各家不同，先只做支付宝、微信 + 通用 CSV |

---

## 2. 数据模型

新迁移一份（编号顺延），全部带 `householdId`，家庭隔离测试照旧补。

### 2.1 `finance_transactions` 加列

| 列 | 类型 | 说明 |
| --- | --- | --- |
| externalId | varchar(64) 可空 | 支付宝「交易订单号」/ 微信「交易单号」；`UQ (householdId, sourceType, externalId)` 部分索引（externalId 非空时） |
| merchant | varchar(120) 可空 | 交易对方；导入与截图识别填，手工记账可不填 |
| attachmentPath | varchar(255) 可空 | 截图文件名，文件放 `uploads/.private/finance/<家庭>/`（和地图底图同一套做法，整个 uploads 已在备份里） |

`FINANCE_TRANSACTION_SOURCE_TYPES` 加 `'import'`、`'recurring'`、`'screenshot'`。

### 2.2 `finance_imports` 导入批次

| 列 | 类型 | 说明 |
| --- | --- | --- |
| id / householdId | | |
| source | `alipay` / `wechat` / `csv` | |
| fileName | varchar(255) | 只记名字，原文件不保留 |
| accountId | uuid FK | 导入到哪个账户 |
| status | `previewing` / `committed` / `discarded` | 预览阶段的解析结果放服务端缓存（或 jsonb 列 `preview`），确认后清空 |
| totalRows / importedRows / skippedRows / duplicateRows | int | |
| rangeFrom / rangeTo | date | 文件里的时间范围，展示用 |
| createdById / createdAt / committedAt | | |

### 2.3 `finance_merchant_rules` 商户 → 分类映射

| 列 | 类型 | 说明 |
| --- | --- | --- |
| id / householdId | | |
| pattern | varchar(120) | 商户名归一化后的关键词（去掉「-」后缀、门店编号等） |
| categoryId | uuid FK | |
| hits | int | 命中次数，排序用 |
| updatedAt | | |

内置一份不入库的默认关键词表（美团/饿了么 → 餐饮，滴滴/高德/地铁 → 交通，京东/淘宝/拼多多 → 购物，国家电网/燃气/水务 → 居家，药房/医院 → 医疗……），家庭规则优先于默认表。

### 2.4 `finance_recurring` 周期账单

| 列 | 类型 | 说明 |
| --- | --- | --- |
| id / householdId | | |
| title | varchar(120) | 房租、物业费、水电、视频会员…… |
| type | `expense` / `income` | 收入也有周期（工资） |
| amount | numeric(14,2) | |
| accountId / categoryId | uuid FK | |
| cadence | `weekly` / `monthly` / `quarterly` / `yearly` | |
| anchorOn | date | 第一次应扣日；monthly 取其 day（29～31 日按月末处理） |
| nextDueOn | date | 由 anchorOn + cadence 推进 |
| autoPost | bool | true：到期自动落流水；false：到期只提醒，人点「已付」才落 |
| lastPostedOn | date 可空 | |
| isActive / createdById / updatedById / version | | |

自动落的流水：`sourceType = 'recurring'`，`idempotencyKey = recurring:<id>:<nextDueOn>`，天然幂等。

### 2.5 `finance_accounts` 加信用卡

`type` 加 `'credit'`；加列 `creditLimit numeric 可空`、`billingDay smallint 可空`、`dueDay smallint 可空`（只对 credit 有意义，CHECK 约束非 credit 时为空）。信用卡余额为负表示欠款；还款就是现有的 `transfer`（银行 → 信用卡），不加新流水类型。

### 2.6 分类种子

`DEFAULT_CATEGORIES` 从 12 个补到约 30 个，仍平铺。支出补：服饰、教育、育儿、宠物、通讯、水电燃气、物业房租、保险、维修、旅行、数码、烟酒零食；收入补：理财收益、退款、红包。已存在家庭的补种子沿用现有「按 systemKey 缺则补」逻辑，不覆盖用户改过的名字。

---

## 3. 分期

### K0 分类补齐与契约（XS，半天）

§2.6 的种子；`contracts/finance.ts` 加 `'credit'`、三个新 sourceType、`merchant / externalId / attachmentPath` 字段（可选）；manifest 不变。

### K1 支付宝 / 微信账单导入（M，约 4 天）

**入口**：财务页「导入账单」按钮（`record_finance` 能力）。先选账户、选来源，再传文件。

**解析**（`apps/api/src/finance/import/`，每个来源一个 parser，纯函数、单测覆盖）：

| | 支付宝 | 微信 |
| --- | --- | --- |
| 导出路径 | App → 我的 → 账单 → 右上角 … → 开具交易流水证明 → 用于个人对账 → 邮箱收 CSV | App → 我 → 服务 → 钱包 → 账单 → 常见问题 → 下载账单 → 用于个人对账 |
| 编码 | GBK | UTF-8 |
| 表头前 | 若干行说明文字，到「交易时间」那一行才是表头 | 同上，到「交易时间」 |
| 关键列 | 交易时间、交易分类、交易对方、商品说明、收/支、金额、收/付款方式、交易状态、交易订单号 | 交易时间、交易类型、交易对方、商品、收/支、金额(元)、支付方式、当前状态、交易单号 |
| 金额 | 纯数字 | `¥12.00` 去符号 |

列名以「包含」匹配，不按固定位置，两家改版时只改映射表。通用 CSV：用户在预览前手动指定「日期 / 金额 / 收支 / 对方 / 备注 / 单号」六列对应关系。

**行分类规则**（预览里逐行可改）：

| 原始 | 处理 |
| --- | --- |
| 收/支 = 支出，状态 = 交易成功 | expense，分类按 §2.3 规则 |
| 收/支 = 收入 | income，默认「其他收入」；对方含「退款」→ 分类「退款」 |
| 收/支 = 不计收支 | 默认不勾选（余额宝转入转出、零钱通、信用卡还款、亲友转账）；若对方能对上家庭里另一个账户名，建议 transfer |
| 状态 = 交易关闭 / 退款成功 / 已全额退款 | 默认不勾选 |
| 交易单号已存在（`externalId` 命中） | 标「已导入」，不可勾选 |
| 同账户、同金额、同日已有一笔手工/截图流水 | 标「疑似重复」，默认不勾选，可手动勾上 |

**预览页**：表格列 = 勾选 / 日期 / 对方 / 商品 / 金额 / 收支 / 分类（下拉可改）/ 标记。顶部汇总：共 N 行，建议导入 M 行，已导入 X，疑似重复 Y。底部「确认导入」。改过分类的行，确认时写 `finance_merchant_rules`。

**写入**：事务内批量建流水（走现有 `createTransaction` 的内部方法，复用 postings 逻辑），`sourceType = 'import'`，`idempotencyKey = import:<importId>:<externalId>`。完成后 toast「导入 M 笔，跳过 S 笔」，批次记录可在「导入记录」里看（只列表，不回滚——回滚用现有冲销逐笔做，或下一轮再议「撤销整批」）。

**限制**：文件 ≤ 5 MB、≤ 5000 行；预览缓存 30 分钟过期。

### K2 截图记账（S～M，约 3 天，排 J4 之后）

**入口**：「记一笔」表单顶部「传截图」；仅当家庭已开云端档且配置了支持图像的模型时显示。

**流程**：上传图片（≤ 4 MB，jpg/png/webp）→ 服务端调 J4 的云端适配器（OpenAI 兼容 vision，提示词要求只返回 JSON：`amount / direction / merchant / occurredAt / payMethod / note`）→ 结果预填表单（金额、对方、日期、分类按 §2.3 规则、账户按 payMethod 猜：含「花呗/余额/支付宝」→ alipay，「零钱/微信」→ wechat，「信用卡」→ credit 类账户）→ 用户确认才落流水，`sourceType = 'screenshot'`，截图存 `attachmentPath`，流水详情可看截图。

**与导入的关系**：截图记的流水没有交易单号，之后导入 CSV 时靠 §3-K1 的「疑似重复」规则提示，由人决定。

**自然语言记账**不在本阶段：`finance.record-expense` 模板由 J3 的第 0 档引擎实现；K2 只补一条「截图里的文字也可以喂给第 0 档做兜底」的接口，不实现。

**脱敏**：截图里有卡号、姓名，发云端前不做图片脱敏（做不到），但遵守 J4 的「云端档默认关 + 每日上限」，并在开关说明里写明「截图会发给你配置的模型服务商」。

### K3 周期账单（M，约 3 天）

**页面**：财务页新分段「固定支出」（管理员可增删改，成员只读）：列表 = 标题 / 金额 / 周期 / 下次日期 / 自动记账开关。月汇总页「固定支出」一行 = 周期账单月均 + 资产续费月均 + 观影订阅月均（后两者只读汇总，各自仍在原模块管理）。

**调度**：沿用 agent-routine / 资产续费已有的每日任务机制，每天上海时间 06:00 扫 `nextDueOn <= today && isActive`：`autoPost` 的直接落流水并推进 `nextDueOn`；非 autoPost 的进「留意」（`FinanceRecurringDueProvider`，到期前 3 天到当天），点「已付」落流水并推进。漏跑多天（NAS 关机）时逐期补落，每期一条，靠 idempotencyKey 不重复。

**manifest**：`attention` 列表加这个 provider；`eventRoutes` 不变。

### K4 信用卡账户（S，约 1.5 天）

§2.5 的列；账户卡片对 credit 显示「欠款 / 额度 / 账单日 / 还款日」；留意：还款日前 3 天且欠款 > 0 → 「信用卡 X 还款日 N 日，欠 ¥…」（`FinanceCreditDueProvider`）。还款用现有转账。预算汇总里信用卡消费按流水本身的分类计入，不按还款计入（避免重复算支出）。

### K5 不做（记录以备后用）

AA 分摊、贷款台账、储蓄目标、多币种、对外 token API、整批撤销导入、本地视觉模型。

---

## 4. 权限矩阵（与 §8.6 第 3 条对齐）

| 动作 | 普通成员 | 管理员 |
| --- | --- | --- |
| 记一笔、看流水、看汇总 | ✓ | ✓ |
| 导入账单（到已有账户） | ✓ | ✓ |
| 截图记账 | ✓（家庭开了云端档时） | ✓ |
| 建 / 改 / 停账户（含信用卡） | — | ✓ |
| 预算、冲销 | — | ✓ |
| 周期账单增删改、自动记账开关 | — | ✓ |
| 周期账单「已付」 | ✓ | ✓ |
| 商户映射规则（随预览改分类自动写） | ✓ | ✓ |

能力名：现有 `view_finance / record_finance / manage_finance`，不加新能力；导入、截图、「已付」归 `record_finance`，其余归 `manage_finance`。

---

## 5. 验收（每个子阶段合入前）

- **K0**：新家庭种子 30 个分类；老家庭升级后缺的补上、改过名的不动。
- **K1**：用 `apps/api/test/fixtures/finance/` 下的两份脱敏样例（支付宝 GBK、微信 UTF-8，各 ≥ 50 行，覆盖支出 / 收入 / 不计收支 / 交易关闭 / 退款）：预览行数与标记正确；确认导入后流水数、账户余额正确；**同一文件再导一次 0 新增**；改一行分类后再导相似商户自动命中；普通成员能导入、不能选不存在的账户；e2e：上传 → 预览 → 改分类 → 确认 → 流水里能看到。
- **K2**：mock 云端适配器返回固定 JSON，表单预填正确；未开云端档时入口不渲染；流水详情能打开截图；截图文件在备份里。
- **K3**：建一条月付 autoPost，把系统时间推到到期日跑调度，流水生成一条且再跑不重复；漏跑 3 期补 3 条；非 autoPost 的在留意里出现并能「已付」；汇总页固定支出三项合计正确。
- **K4**：建信用卡账户、记两笔支出、转账还款后欠款归零；还款日前 3 天留意出现；预算汇总不把还款算成支出。
- 全部：家庭隔离测试、Playwright 全量零改动通过、`docs/api-inventory.md` 补新路由。

---

## 6. 工作量与顺序

| 阶段 | 量 | 前置 |
| --- | --- | --- |
| K0 | XS（0.5 天） | J1 财务域迁完 |
| K1 | M（4 天） | K0 |
| K3 | M（3 天） | K0 |
| K4 | S（1.5 天） | K0 |
| K2 | S～M（3 天） | K0、**J4 云端适配器** |

合计约 12 天。顺序：K0 → K1 → K3 → K4 →（J4 之后）K2。K1/K3/K4 互不依赖，可按空档穿插；都不改内核、不改页面骨架，可在家庭试用期间上线。

---

## 7. 从 HomeLedger 借了什么、没借什么

| 借 | 怎么落 |
| --- | --- |
| 支付宝 / 微信 CSV 导入 + 去重 + 分类映射 | K1，去重改为单号唯一索引，映射改为家庭级可学习规则 |
| 截图识别 + 无 API 时退回 | K2 走云端档；「退回」由 J3 第 0 档承担 |
| 周期账单、月均折算 | K3 |
| 信用卡额度 / 账单日 | K4 |
| 209 个分类 | 只借思路，补到 30 个平铺 |

| 没借 | 原因 |
| --- | --- |
| 14 种流水类型、10 种账户类型 | 复式 postings 四种类型已能表达；账户加 credit 一种就够 |
| 多账本 / 邀请制成员 | 小管家已有家庭与成员体系 |
| SSR + SQLite 架构 | 栈不同 |
| Open API token | 由助理层 propose 工具覆盖 |

## 8. 执行记录（Phase K 第一批：K0 → K3 → K4，2026-10-06）

### 8.1 进度

| 阶段 | 状态 | 说明 |
| --- | --- | --- |
| K0 分类补齐与契约 | ☑ | 默认分类 27 个；契约加 credit、import / recurring / screenshot、流水三个可选字段 |
| K3 周期账单 | ☑ | 表与接口、自动记账调度、到期留意、汇总页固定支出、「固定支出」分段 |
| K4 信用卡账户 | ☑ | 额度 / 账单日 / 还款日、「欠 ¥…」、还款日留意、转账还款 |
| K1 账单导入 | ☐ | 等 King 把脱敏样例放进 `apps/api/test/fixtures/finance/` 后另起一批 |
| K2 截图记账 | ☐ | 等 J4 云端适配器 |

### 8.2 提交

| 步 | 内容 | 提交 | 合并 | CI |
| --- | --- | --- | --- | --- |
| 收尾 | J1b 演示栈升级记录、执行顺序调整 | `3623461` | `da32c88` | 一次过（#37471521146） |
| K0 | 默认分类 12 → 27、契约 | `7481f2b` | `0f8f1bb` | 一次过（#37472150658） |
| K3.1 | `finance_recurring` 表与增删改 / 「已付」接口 | `da68b9b` | `9091657` | 一次过（#37473856349） |
| K3.2 | 自动记账调度、到期留意、固定支出汇总、资产门面 | `3b4c8e2` | `0d6a2ff` | 一次过（#37475609618） |
| K3.3 | 「固定支出」分段、概览固定支出一行 | `bdadd37` | `4bb7a58` | 一次过（#37476934192） |
| K4 | 信用卡账户；固定支出开关加「自动记账」字样（截图走查补的） | `6b0bc5e`、`9f13e99` | `327040a` | 一次过（#37479543765；`6b0bc5e` 那次 #37478969383 被紧接着推的 `9f13e99` 按并发组取消，以分支头为准） |
| 收口 | 手机上固定支出一行放得下（截图走查补的）、本进度文档 | `461352e`、见本次合并 | 见本次合并 | 见本次合并 |

**新表 / 新列（最终结构）**

- `finance_recurring`（迁移 `AddFinanceRecurring1785233800000`）：`id` / `householdId`；`title` varchar(120)；`type` `expense` / `income`；`amount` numeric(14,2) > 0；`accountId` / `categoryId`（FK，RESTRICT）；`cadence` `weekly` / `monthly` / `quarterly` / `yearly`；`anchorOn` date；`nextDueOn` date（≥ `anchorOn`）；`autoPost` bool 默认 false；`lastPostedOn` date 可空；`isActive` 默认 true；`version` ≥ 1；`createdById` / `updatedById`；`createdAt` / `updatedAt`。索引 `(householdId, isActive, nextDueOn)`。
- `finance_transactions` 加 `externalId` varchar(64)、`merchant` varchar(120)、`attachmentPath` varchar(255)（都可空，K1 / K2 用），部分唯一索引 `(householdId, sourceType, externalId) WHERE externalId IS NOT NULL`；来源 CHECK 加 `import` / `recurring` / `screenshot`。
- `finance_accounts`（迁移 `AddFinanceCreditAccounts1785233900000`）：类型加 `credit`；加 `creditLimit` numeric(14,2)（> 0）、`billingDay` / `dueDay` smallint（1～31）；CHECK 非信用卡三项必须为空。

**接口**：`GET /finance/recurring`（view_finance）；`POST` / `PATCH /finance/recurring/:id` / `DELETE /finance/recurring/:id`（manage_finance，乐观锁）；`POST /finance/recurring/:id/pay`（record_finance，带 `dueOn`，幂等）。`GET /finance/summary` 加 `fixedCosts { recurring, assets, total }`。建 / 改账户可带 `creditLimit` / `billingDay` / `dueDay`。新路由都在 manifest 的 `/finance` 前缀下，事件路由不用改。

**跨插件**：K3 唯一的跨插件点是资产门面 `monthlyRecurringCost(householdId)`（`contracts/plugins/assets.facade.ts`），财务 manifest `dependsOn: ['assets']`，check-plugins 断言一致。

**留意**：`finance.recurring`（`FinanceRecurringDueProvider`）、`finance.credit`（`FinanceCreditDueProvider`），都走 `AttentionRegistry`，kind 与文案在 manifest；都不设能力门槛。J1.7 的留意对比探针在 main 与 K3.2 上对本地库各跑一次（6 份成员 × 角色、16 条），逐字节一致。

### 8.3 与计划不一样的地方

1. **K0 默认分类是 27 个，不是 30**：§2.6 的名单是在原 12 个上补 15 个（支出 12、收入 3），照名单做；没有另编 3 个凑数。
2. **汇总页「固定支出」只有两项**：周期账单（只算在用的支出）+ 资产续费。观影没有订阅费用的数据——观影里的「订阅」是 MoviePilot 的下载订阅，没有金额；视频会员这类付费订阅登记在资产的「订阅」分类里，已算进资产续费——所以没加观影门面，`dependsOn` 只有 `assets`。资产续费月均的口径：在用的订阅类资产，购买价格当作每期续费金额 ÷ 续费间隔月数。
3. **新建周期账单不往回补**：第一次应付日早于今天时，下一期从不早于今天的那一期开始（不然老房租一建就补一年）。「漏跑逐期补」针对的是调度停机（NAS 关机）；验收的「漏跑 3 期补 3 条」在黑盒里把下一期拨回三期前来模拟。
4. **到期没付的继续留在留意里、标逾期**（和资产续费一样），计划写的是「到期前 3 天到当天」。
5. **「已付」的细节**：带上看到的那一期（重复点返回同一笔）；记账日是点的那天，自动落的记账日是那一期的应付日；到期前 3 天起才能点；自动记账的、停用的不能点。
6. **调度**：沿用助理例行任务的进程内定时轮询（默认每分钟），每家按自己时区 06:00 判当天的能不能落（现有家庭都是上海）；自动落的流水记在最早的在用家庭主人名下、显示名「自动记账」。
7. **K3.1 把 `FinanceService` 从 `finance.module.ts` 原样搬进 `finance.service.ts`**（逐字一致）：周期账单服务要用它，留在模块文件里会互相 import。
8. 流水的三列在 K3 的迁移里加（指令写「K3 / K1 的迁移」，K3 先到）。
9. **K4**：信用卡的账单日、还款日必填，额度选填；新建时界面填「当前欠多少」，存成负的初始余额；余额 0 写「已还清」，正数写「多还 ¥…」。信用卡留意的名字里带欠多少（文案模板只有 `{name}` / `{soon}`），「去还款」直接打开转账表单；过了还款日看下个月的，不标逾期。
10. **固定支出列表上的「删除」放在编辑对话框里**（仍二次确认）：390 宽的手机上一行放不下「已付 + 自动记账 + 编辑 / 停用 / 删除」，手机上开关字样也缩成「自动」。
11. 财务留意以前只有一种，这批起会和别的种类合成一张卡：补了 `mixedTitle`（「{n} 件财务的事要看」），`listActionLabel` 改成「去财务看看」（这项只在混合卡上用，以前用不到）。

### 8.4 发现但没修

- 资产表没有专门的「续费金额」，资产续费月均借用购买价格；登记订阅时没填价格的不算进去。
- 自动记账落失败（比如账户被停用）只记一句日志，同一天不重复报；没有进留意或通知。
- 老家庭的新分类在第一次读分类时补（打开财务页、记一笔都会读），升级后不会自己补。
