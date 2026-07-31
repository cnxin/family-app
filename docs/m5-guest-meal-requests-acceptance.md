# M5-C2 访客点菜请求验收

## 已交付

- 家庭管理员创建访客邀请时可以显式开启“允许提交点菜请求”，默认关闭。
- 获授权访客首先可查看本次来访期间已安排、尚未划掉的家庭菜单，并从中选择想吃的菜；选择保留到具体 `menu_item` 的引用。
- 菜单外需求仍可按来访日期和早餐、午餐或晚餐提交菜名及可选口味备注。
- 家庭管理员在来访卡片中查看请求并接受或拒绝，可附带处理备注。
- 访客请求独立保存在 `guest_meal_requests`，不会创建或改写 `MenuItem`、不会成为家庭成员，也不会公开菜谱做法、库存或下单成员。

## API

```text
POST  /visits/:id/invitations                         (allowsMealRequests 可选，需 manage_guests)
GET   /guest-invitations/:token                       (公开；capabilities.mealRequests 与 mealRequestDates)
GET   /guest-invitations/:token/meal-requests         (公开；仅限有效、已授权邀请)
POST  /guest-invitations/:token/meal-requests         (公开；创建或修改待处理请求)
GET   /guest-invitations/:token/meal-options          (公开；本次来访期间的可选菜单菜品)
POST  /guest-invitations/:token/meal-options/:menuItemId/request (公开；选择菜单菜品)
PATCH /guest-meal-requests/:id                         (需 manage_guests；接受或拒绝)
```

公开响应仅返回该邀请自己的请求、菜单菜品名称/分类/图片和处理状态，不包含家庭成员、下单成员、菜谱做法、库存、账户资料或访问令牌摘要。

## 自动验收

- 默认邀请无法读取或提交点菜请求。
- 访客只能读取本次来访期间、仍开放且未划掉的菜单菜品；不能读取下单成员或菜谱详情。
- 访客选择菜单菜品时保留 `menuItemId` 引用，但不会新建或改写家庭菜单项。
- 请求日期必须属于本次来访期间；餐次仅限早餐、午餐和晚餐。
- 访客可更新待处理请求，但管理员处理后不能再覆盖该请求。
- 管理员可以接受或拒绝本家庭的请求；请求不会产生家庭菜单项或成员身份。
- 邀请撤销、到期或来访取消后，公开读取和写入立即失效。

## 后续边界

- 菜单外请求接受后不自动加入家庭菜单，避免在未确认菜谱、主厨和备料前写入正式点菜流程。
- 后续可允许家庭成员把菜单外请求显式采纳到菜单，并选择目标菜单、菜谱做法和主厨，同时保留访客请求来源链接。
