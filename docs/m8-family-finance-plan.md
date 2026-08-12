# M8 家庭财务与 Hermes 记账方案

> 状态：M8-A1 已实现。范围为家庭共享账本，不是个人私密理财或银行聚合服务。

## 1. 产品边界

家庭财务作为首页独立模块，首批解决四件事：知道各家庭账户还有多少钱、记录收入/支出/转账、按月设置分类预算、让 Hermes 在用户确认后协助记账。

首批不连接银行、微信或支付宝账号，不保存支付密码、银行卡号、账单登录凭据或个人征信信息；不导入 CSV/Excel，不上传小票，不从购物、资产、媒体订阅直接静默记账，也不允许 Hermes 无人值守写账。财务事实不进入智能体长期记忆。

## 2. 权限和可见性

- `owner/admin`：查看共享账本、记录流水、管理账户和分类、维护预算、撤销误记流水。
- `member`：查看共享账本并记录收入、支出和账户间转账。
- 访客：无财务入口和 API 权限。
- 当前是家庭共享账本，所有具备 `view_finance` 的正式成员都能查看全部账户与流水；首批不提供“仅自己可见”的伪隐私选项。

对应能力为 `view_finance`、`record_finance`、`manage_finance`。所有资源查询同时约束 `householdId`，跨家庭 ID 按不存在处理。

## 3. 数据模型

| 表 | 责任 |
| --- | --- |
| `finance_accounts` | 现金、银行卡、支付宝、微信和其他家庭账户；保存初始余额、启用状态和版本 |
| `finance_categories` | 收入/支出分类；系统默认分类按家庭幂等创建，也可增加自定义分类 |
| `finance_transactions` | 不可变业务流水；保存类型、金额、日期、分类、操作者、来源、请求指纹和撤销关系 |
| `finance_postings` | 不可变账户过账；支出为负、收入为正、转账为一负一正 |
| `finance_budgets` | 家庭、月份和支出分类唯一的可版本化预算 |

金额使用 PostgreSQL `numeric(14,2)`，首批币种固定为 `CNY`。账户余额不存冗余可变字段，始终按 `openingBalance + SUM(postings.delta)` 计算。

`finance_transactions` 与 `finance_postings` 由数据库触发器拒绝 UPDATE/DELETE。误记通过新增 `reversal` 交易和金额相反的 posting 修正；原流水、操作者和来源永久保留。`householdId + idempotencyKey` 唯一，请求指纹阻止同一幂等键复用不同参数；`reversalOfId` 部分唯一索引阻止重复撤销。

## 4. API

```text
GET    /finance/summary?month=YYYY-MM
GET    /finance/accounts
POST   /finance/accounts
PATCH  /finance/accounts/:id
GET    /finance/categories
POST   /finance/categories
PATCH  /finance/categories/:id
GET    /finance/transactions?month=YYYY-MM&type=...
POST   /finance/transactions
POST   /finance/transactions/:id/reverse
GET    /finance/budgets?month=YYYY-MM
PUT    /finance/budgets
DELETE /finance/budgets/:id?expectedVersion=...
```

交易创建和撤销使用事务与家庭范围 advisory lock。预算、账户和分类使用预期版本避免并发覆盖。账户/分类停用后历史仍可读取，不能用于新流水。

## 5. 客户端体验

`/finance` 提供四个触控视图：

- 概览：家庭总余额、本月收入、支出、结余、账户余额和预算进度。
- 流水：按收入、支出和转账筛选；显示日期、分类、账户、记录人和撤销状态。
- 预算：按支出分类设置月度预算，显示已用、剩余和超支状态。
- 账户：维护财务账户和收支分类，停用时保留历史。

“记一笔”使用收入/支出/转账分段选择，包含金额、账户、目标账户、分类、名称、日期和备注。所有操作可用鼠标或触控完成，不依赖键盘快捷键；主要触控目标至少 44pt。页面顶部可带当前 `/finance` 上下文进入“问问小管家”。

## 6. Hermes 边界

开放两个 MCP 工具：

```text
get_finance_summary
propose_finance_transaction
```

Hermes 回答余额、收支或预算前必须调用 `get_finance_summary`。生成提案前也必须先查询真实账户与分类 ID；金额、类型、账户、分类或日期不明确时先追问。

`propose_finance_transaction` 只创建单笔 `finance` 操作提案。提案卡展示金额、日期、账户、分类和共享账本提示；成员在 Family App 明确确认后，`AgentProposalsService` 才在同一数据库事务中调用 `FinanceService.createWithinTransaction`。执行来源记录为 `agent` 和提案 ID。财务动作首批不进入 `propose_plan` 多步骤组提案，消息渠道继续只读。

## 7. M8-A1 验收

- 新家庭可幂等建立默认收支分类，管理员可创建、编辑和停用账户与分类。
- 普通成员可查看共享账本并记录三类流水，但不能改预算、账户或撤销流水。
- 收入、支出和转账生成正确 posting，余额、月度收支、结余、分类支出和预算进度一致。
- 重复请求只产生一笔流水，不同参数复用幂等键返回冲突。
- 数据库拒绝修改/删除交易和 posting；撤销使用唯一反向流水。
- 跨家庭账户、分类、预算和流水不可访问。
- Hermes 查询返回真实账户/分类；提案确认前没有业务流水，确认后只写入一笔并保留 Agent 来源。
- API 构建、迁移、结构漂移、全量 API、移动端类型、Lint、Expo Web 导出和响应式浏览器验收通过。

## 8. 后续阶段

1. 购物完成、资产购买和媒体会员订阅生成“待确认财务草稿”，不直接入账。
2. 周期账单模板与到期提醒；实际记账仍由成员确认。
3. 微信/支付宝导出账单导入、字段映射、预览和去重，不接管支付账号。
4. 家庭费用分摊、成员垫付和结算状态。
5. 小票和账单附件使用独立加密、细粒度授权、访问审计和保留策略。
