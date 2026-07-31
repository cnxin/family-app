# M5-C2 访客点菜请求验收

## 已交付

- 家庭管理员创建访客邀请时可以显式开启“允许提交点菜请求”，默认关闭。
- 获授权访客可按本次来访涵盖的日期和早餐、午餐或晚餐提交想吃的菜及可选口味备注；每个日期和餐次保留一条可修改的待处理请求。
- 家庭管理员在来访卡片中查看请求并接受或拒绝，可附带处理备注。
- 访客请求独立保存在 `guest_meal_requests`，不会创建 `MenuItem`、不会成为家庭成员，也不会公开家庭菜谱、库存或正式菜单。

## API

```text
POST  /visits/:id/invitations                         (allowsMealRequests 可选，需 manage_guests)
GET   /guest-invitations/:token                       (公开；capabilities.mealRequests 与 mealRequestDates)
GET   /guest-invitations/:token/meal-requests         (公开；仅限有效、已授权邀请)
POST  /guest-invitations/:token/meal-requests         (公开；创建或修改待处理请求)
PATCH /guest-meal-requests/:id                         (需 manage_guests；接受或拒绝)
```

公开响应仅返回该邀请自己的请求、处理状态和处理备注，不包含家庭成员、菜谱、库存、菜单条目、账户资料或访问令牌摘要。

## 自动验收

- 默认邀请无法读取或提交点菜请求。
- 请求日期必须属于本次来访期间；餐次仅限早餐、午餐和晚餐。
- 访客可更新待处理请求，但管理员处理后不能再覆盖该请求。
- 管理员可以接受或拒绝本家庭的请求；请求不会产生家庭菜单项或成员身份。
- 邀请撤销、到期或来访取消后，公开读取和写入立即失效。

## 后续边界

- 接受访客请求不自动加入家庭菜单，避免在未确认菜谱、主厨和备料前写入正式点菜流程。
- 后续若需要“一键采纳到菜单”，应由已登录家庭成员显式选择目标菜单、菜谱做法和主厨，并保留访客请求来源链接。
