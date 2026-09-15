# API 端点清单

> 由 `node scripts/api-inventory.mjs` 从 `apps/api/src` 的 Controller 自动生成，请勿手改。
> 用途：重构迁移时逐条对照；`--check` 模式在 CI 里保证清单与代码一致。
> 权限列只反映装饰器（`@Public` / `@RequireCapabilities`）；标"登录"的端点仍可能在 Service 内部用 `assertCapability` 或角色判断做二次校验。

共 275 个端点（POST 116 / GET 86 / PATCH 41 / DELETE 24 / PUT 8），公开端点 27 个。

| 模块 | 端点数 |
| --- | ---: |
| activities | 1 |
| agent | 40 |
| assets | 18 |
| auth | 16 |
| calendar | 4 |
| dishes | 5 |
| finance | 13 |
| guests | 21 |
| inventory | 13 |
| knowledge | 8 |
| media | 32 |
| memories | 8 |
| menus | 9 |
| notifications | 11 |
| points | 12 |
| polls | 8 |
| recipes | 7 |
| reminders | 5 |
| shopping | 5 |
| smart-menu | 4 |
| system | 8 |
| tasks | 5 |
| travel | 21 |
| upload | 1 |

## activities（1）

| 方法 | 路径 | 处理函数 | 权限 | 文件 |
| --- | --- | --- | --- | --- |
| GET | `/activities` | `ActivitiesController.list` | 登录 | `apps/api/src/activities/activities.module.ts` |

## agent（40）

| 方法 | 路径 | 处理函数 | 权限 | 文件 |
| --- | --- | --- | --- | --- |
| GET | `/agent/channel-pairings` | `AgentController.pairings` | `use_agent` `manage_agent` | `apps/api/src/agent/agent.controller.ts` |
| POST | `/agent/channel-pairings` | `AgentController.createPairing` | `use_agent` `manage_agent` | `apps/api/src/agent/agent.controller.ts` |
| POST | `/agent/channel-pairings/:id/revoke` | `AgentController.revokePairing` | `use_agent` `manage_agent` | `apps/api/src/agent/agent.controller.ts` |
| GET | `/agent/channels` | `AgentController.channelsList` | `use_agent` | `apps/api/src/agent/agent.controller.ts` |
| POST | `/agent/channels/:id/revoke` | `AgentController.revokeChannel` | `use_agent` | `apps/api/src/agent/agent.controller.ts` |
| GET | `/agent/conversations` | `AgentController.conversations` | `use_agent` | `apps/api/src/agent/agent.controller.ts` |
| POST | `/agent/conversations` | `AgentController.createConversation` | `use_agent` | `apps/api/src/agent/agent.controller.ts` |
| GET | `/agent/conversations/:id` | `AgentController.conversation` | `use_agent` | `apps/api/src/agent/agent.controller.ts` |
| DELETE | `/agent/conversations/:id` | `AgentController.archive` | `use_agent` | `apps/api/src/agent/agent.controller.ts` |
| POST | `/agent/conversations/:id/messages` | `AgentController.send` | `use_agent` | `apps/api/src/agent/agent.controller.ts` |
| GET | `/agent/memories` | `AgentController.memories` | `use_agent` | `apps/api/src/agent/agent.controller.ts` |
| DELETE | `/agent/memories` | `AgentController.clearMemories` | `use_agent` | `apps/api/src/agent/agent.controller.ts` |
| PATCH | `/agent/memories/:id` | `AgentController.correctMemory` | `use_agent` | `apps/api/src/agent/agent.controller.ts` |
| DELETE | `/agent/memories/:id` | `AgentController.forgetMemory` | `use_agent` | `apps/api/src/agent/agent.controller.ts` |
| POST | `/agent/memories/:id/confirm` | `AgentController.confirmMemory` | `use_agent` | `apps/api/src/agent/agent.controller.ts` |
| POST | `/agent/memories/:id/share` | `AgentController.shareMemory` | `use_agent` | `apps/api/src/agent/agent.controller.ts` |
| POST | `/agent/memories/candidates` | `AgentController.createMemoryCandidate` | `use_agent` | `apps/api/src/agent/agent.controller.ts` |
| GET | `/agent/profile` | `AgentController.profile` | `use_agent` | `apps/api/src/agent/agent.controller.ts` |
| PATCH | `/agent/profile` | `AgentController.updateProfile` | `use_agent` | `apps/api/src/agent/agent.controller.ts` |
| GET | `/agent/proposal-groups` | `AgentController.proposalGroupList` | `use_agent` | `apps/api/src/agent/agent.controller.ts` |
| GET | `/agent/proposal-groups/:id` | `AgentController.proposalGroup` | `use_agent` | `apps/api/src/agent/agent.controller.ts` |
| POST | `/agent/proposal-groups/:id/confirm` | `AgentController.confirmProposalGroup` | `use_agent` | `apps/api/src/agent/agent.controller.ts` |
| POST | `/agent/proposal-groups/:id/reject` | `AgentController.rejectProposalGroup` | `use_agent` | `apps/api/src/agent/agent.controller.ts` |
| POST | `/agent/proposals/:id/confirm` | `AgentController.confirmProposal` | `use_agent` | `apps/api/src/agent/agent.controller.ts` |
| POST | `/agent/proposals/:id/reject` | `AgentController.rejectProposal` | `use_agent` | `apps/api/src/agent/agent.controller.ts` |
| GET | `/agent/routines` | `AgentController.routinesList` | `use_agent` `manage_agent` | `apps/api/src/agent/agent.controller.ts` |
| PATCH | `/agent/routines/:kind` | `AgentController.updateRoutine` | `use_agent` `manage_agent` | `apps/api/src/agent/agent.controller.ts` |
| PUT | `/agent/routines/nightly_digest/delivery` | `AgentController.configureNightlyDelivery` | `use_agent` `manage_agent` | `apps/api/src/agent/agent.controller.ts` |
| POST | `/agent/runs/:id/cancel` | `AgentController.cancel` | `use_agent` | `apps/api/src/agent/agent.controller.ts` |
| POST | `/agent/runs/:id/retry` | `AgentController.retry` | `use_agent` | `apps/api/src/agent/agent.controller.ts` |
| GET | `/agent/settings` | `AgentController.settings` | `use_agent` | `apps/api/src/agent/agent.controller.ts` |
| PUT | `/agent/settings` | `AgentController.updateSettings` | `use_agent` `manage_agent` | `apps/api/src/agent/agent.controller.ts` |
| PATCH | `/agent/settings` | `AgentController.patchSettings` | `use_agent` `manage_agent` | `apps/api/src/agent/agent.controller.ts` |
| GET | `/agent/status` | `AgentController.status` | `use_agent` | `apps/api/src/agent/agent.controller.ts` |
| POST | `/internal/agent/channels/:channelId/messages` | `AgentChannelInternalController.message` | 公开 | `apps/api/src/agent/agent-channel-internal.controller.ts` |
| GET | `/internal/agent/channels/:channelId/runs/:runId` | `AgentChannelInternalController.run` | 公开 | `apps/api/src/agent/agent-channel-internal.controller.ts` |
| POST | `/internal/agent/channels/pair` | `AgentChannelInternalController.pair` | 公开 | `apps/api/src/agent/agent-channel-internal.controller.ts` |
| GET | `/internal/agent/mcp` | `AgentMcpController.methodNotAllowedGet` | 公开 | `apps/api/src/agent/agent-mcp.controller.ts` |
| POST | `/internal/agent/mcp` | `AgentMcpController.handle` | 公开 | `apps/api/src/agent/agent-mcp.controller.ts` |
| DELETE | `/internal/agent/mcp` | `AgentMcpController.methodNotAllowedDelete` | 公开 | `apps/api/src/agent/agent-mcp.controller.ts` |

## assets（18）

| 方法 | 路径 | 处理函数 | 权限 | 文件 |
| --- | --- | --- | --- | --- |
| DELETE | `/asset-documents/:id` | `AssetsController.removeDocument` | `manage_assets` | `apps/api/src/assets/assets.module.ts` |
| GET | `/asset-documents/:id/access` | `AssetsController.documentAccess` | 登录 | `apps/api/src/assets/assets.module.ts` |
| GET | `/asset-documents/:id/content` | `AssetsController.documentContent` | 公开 | `apps/api/src/assets/assets.module.ts` |
| GET | `/assets` | `AssetsController.list` | 登录 | `apps/api/src/assets/assets.module.ts` |
| POST | `/assets` | `AssetsController.create` | `manage_assets` | `apps/api/src/assets/assets.module.ts` |
| GET | `/assets/:id` | `AssetsController.get` | 登录 | `apps/api/src/assets/assets.module.ts` |
| PATCH | `/assets/:id` | `AssetsController.update` | `manage_assets` | `apps/api/src/assets/assets.module.ts` |
| POST | `/assets/:id/documents` | `AssetsController.createDocument` | `manage_assets` | `apps/api/src/assets/assets.module.ts` |
| POST | `/assets/:id/documents/upload` | `AssetsController.FileInterceptor` | `manage_assets` | `apps/api/src/assets/assets.module.ts` |
| POST | `/assets/:id/maintenance-plans` | `AssetsController.createPlan` | `manage_assets` | `apps/api/src/assets/assets.module.ts` |
| POST | `/assets/:id/renew` | `AssetsController.renewSubscription` | `manage_assets` | `apps/api/src/assets/assets.module.ts` |
| PATCH | `/maintenance-consumables/:id` | `AssetsController.updateConsumable` | `manage_assets` `manage_inventory` | `apps/api/src/assets/assets.module.ts` |
| DELETE | `/maintenance-consumables/:id` | `AssetsController.removeConsumable` | `manage_assets` `manage_inventory` | `apps/api/src/assets/assets.module.ts` |
| PATCH | `/maintenance-plans/:id` | `AssetsController.updatePlan` | `manage_assets` | `apps/api/src/assets/assets.module.ts` |
| POST | `/maintenance-plans/:id/complete` | `AssetsController.completePlan` | `manage_assets` | `apps/api/src/assets/assets.module.ts` |
| POST | `/maintenance-plans/:id/consumables` | `AssetsController.createConsumable` | `manage_assets` `manage_inventory` | `apps/api/src/assets/assets.module.ts` |
| GET | `/maintenance-plans/:id/consumables-preview` | `AssetsController.consumablesPreview` | 登录 | `apps/api/src/assets/assets.module.ts` |
| POST | `/maintenance-plans/:id/shopping-items` | `AssetsController.addConsumablesToShopping` | `manage_assets` `manage_shopping` | `apps/api/src/assets/assets.module.ts` |

## auth（16）

| 方法 | 路径 | 处理函数 | 权限 | 文件 |
| --- | --- | --- | --- | --- |
| PATCH | `/accounts/me/password` | `AuthController.updatePassword` | 登录 | `apps/api/src/auth/auth.module.ts` |
| POST | `/auth/invitations/preview` | `AuthController.previewInvitation` | 公开 | `apps/api/src/auth/auth.module.ts` |
| POST | `/auth/invitations/redeem` | `AuthController.redeemInvitation` | 公开 | `apps/api/src/auth/auth.module.ts` |
| POST | `/auth/login` | `AuthController.login` | 公开 | `apps/api/src/auth/auth.module.ts` |
| POST | `/auth/logout` | `AuthController.logout` | 登录 | `apps/api/src/auth/auth.module.ts` |
| POST | `/auth/refresh` | `AuthController.refresh` | 公开 | `apps/api/src/auth/auth.module.ts` |
| POST | `/auth/setup/bootstrap` | `AuthController.bootstrap` | 公开 | `apps/api/src/auth/auth.module.ts` |
| GET | `/auth/setup/status` | `AuthController.setupStatus` | 公开 | `apps/api/src/auth/auth.module.ts` |
| GET | `/household/invitations` | `AuthController.listInvitations` | `manage_members` | `apps/api/src/auth/auth.module.ts` |
| POST | `/household/invitations` | `AuthController.createInvitation` | `manage_members` | `apps/api/src/auth/auth.module.ts` |
| DELETE | `/household/invitations/:id` | `AuthController.revokeInvitation` | `manage_members` | `apps/api/src/auth/auth.module.ts` |
| GET | `/household/members` | `AuthController.managedMembers` | `manage_members` | `apps/api/src/auth/auth.module.ts` |
| PATCH | `/household/members/:id` | `AuthController.updateManagedMember` | `manage_members` | `apps/api/src/auth/auth.module.ts` |
| PATCH | `/household/members/:id/status` | `AuthController.updateManagedMemberStatus` | `manage_members` | `apps/api/src/auth/auth.module.ts` |
| GET | `/members` | `AuthController.list` | 登录 | `apps/api/src/auth/auth.module.ts` |
| PATCH | `/members/me/preferences` | `AuthController.updatePreferences` | 登录 | `apps/api/src/auth/auth.module.ts` |

## calendar（4）

| 方法 | 路径 | 处理函数 | 权限 | 文件 |
| --- | --- | --- | --- | --- |
| GET | `/calendar` | `CalendarController.list` | 登录 | `apps/api/src/calendar/calendar.module.ts` |
| POST | `/calendar-events` | `CalendarController.create` | 登录 | `apps/api/src/calendar/calendar.module.ts` |
| PATCH | `/calendar-events/:id` | `CalendarController.update` | 登录 | `apps/api/src/calendar/calendar.module.ts` |
| DELETE | `/calendar-events/:id` | `CalendarController.remove` | 登录 | `apps/api/src/calendar/calendar.module.ts` |

## dishes（5）

| 方法 | 路径 | 处理函数 | 权限 | 文件 |
| --- | --- | --- | --- | --- |
| GET | `/dishes` | `DishesController.list` | 登录 | `apps/api/src/dishes/dishes.module.ts` |
| POST | `/dishes` | `DishesController.create` | `manage_recipes` | `apps/api/src/dishes/dishes.module.ts` |
| PATCH | `/dishes/:id` | `DishesController.update` | `manage_recipes` | `apps/api/src/dishes/dishes.module.ts` |
| DELETE | `/dishes/:id` | `DishesController.remove` | `manage_recipes` | `apps/api/src/dishes/dishes.module.ts` |
| GET | `/ingredients` | `DishesController.listIngredients` | 登录 | `apps/api/src/dishes/dishes.module.ts` |

## finance（13）

| 方法 | 路径 | 处理函数 | 权限 | 文件 |
| --- | --- | --- | --- | --- |
| GET | `/finance/accounts` | `FinanceController.accounts` | `view_finance` | `apps/api/src/finance/finance.module.ts` |
| POST | `/finance/accounts` | `FinanceController.createAccount` | `view_finance` `manage_finance` | `apps/api/src/finance/finance.module.ts` |
| PATCH | `/finance/accounts/:id` | `FinanceController.updateAccount` | `view_finance` `manage_finance` | `apps/api/src/finance/finance.module.ts` |
| GET | `/finance/budgets` | `FinanceController.budgets` | `view_finance` | `apps/api/src/finance/finance.module.ts` |
| PUT | `/finance/budgets` | `FinanceController.upsertBudget` | `view_finance` `manage_finance` | `apps/api/src/finance/finance.module.ts` |
| DELETE | `/finance/budgets/:id` | `FinanceController.deleteBudget` | `view_finance` `manage_finance` | `apps/api/src/finance/finance.module.ts` |
| GET | `/finance/categories` | `FinanceController.categories` | `view_finance` | `apps/api/src/finance/finance.module.ts` |
| POST | `/finance/categories` | `FinanceController.createCategory` | `view_finance` `manage_finance` | `apps/api/src/finance/finance.module.ts` |
| PATCH | `/finance/categories/:id` | `FinanceController.updateCategory` | `view_finance` `manage_finance` | `apps/api/src/finance/finance.module.ts` |
| GET | `/finance/summary` | `FinanceController.summary` | `view_finance` | `apps/api/src/finance/finance.module.ts` |
| GET | `/finance/transactions` | `FinanceController.transactions` | `view_finance` | `apps/api/src/finance/finance.module.ts` |
| POST | `/finance/transactions` | `FinanceController.createTransaction` | `view_finance` `record_finance` | `apps/api/src/finance/finance.module.ts` |
| POST | `/finance/transactions/:id/reverse` | `FinanceController.reverseTransaction` | `view_finance` `manage_finance` | `apps/api/src/finance/finance.module.ts` |

## guests（21）

| 方法 | 路径 | 处理函数 | 权限 | 文件 |
| --- | --- | --- | --- | --- |
| DELETE | `/guest-invitations/:id` | `GuestsController.revokeInvitation` | `manage_guests` | `apps/api/src/guests/guests.module.ts` |
| GET | `/guest-invitations/:token` | `GuestsController.publicInvitation` | 公开 | `apps/api/src/guests/guests.module.ts` |
| GET | `/guest-invitations/:token/meal-options` | `GuestsController.publicMealOptions` | 公开 | `apps/api/src/guests/guests.module.ts` |
| POST | `/guest-invitations/:token/meal-options/:menuItemId/request` | `GuestsController.claimMealOption` | 公开 | `apps/api/src/guests/guests.module.ts` |
| GET | `/guest-invitations/:token/meal-requests` | `GuestsController.publicMealRequests` | 公开 | `apps/api/src/guests/guests.module.ts` |
| POST | `/guest-invitations/:token/meal-requests` | `GuestsController.submitMealRequest` | 公开 | `apps/api/src/guests/guests.module.ts` |
| GET | `/guest-invitations/:token/movie-polls` | `GuestsController.publicMoviePolls` | 公开 | `apps/api/src/guests/guests.module.ts` |
| POST | `/guest-invitations/:token/movie-polls/:pollId/votes` | `GuestsController.voteMoviePoll` | 公开 | `apps/api/src/guests/guests.module.ts` |
| POST | `/guest-invitations/:token/response` | `GuestsController.respond` | 公开 | `apps/api/src/guests/guests.module.ts` |
| PATCH | `/guest-meal-requests/:id` | `GuestsController.reviewMealRequest` | `manage_guests` | `apps/api/src/guests/guests.module.ts` |
| GET | `/guest-wifi-profiles` | `GuestsController.listGuestWifiProfiles` | `manage_guests` | `apps/api/src/guests/guests.module.ts` |
| POST | `/guest-wifi-profiles` | `GuestsController.createGuestWifiProfile` | `manage_guests` | `apps/api/src/guests/guests.module.ts` |
| PATCH | `/guest-wifi-profiles/:id` | `GuestsController.updateGuestWifiProfile` | `manage_guests` | `apps/api/src/guests/guests.module.ts` |
| GET | `/guests` | `GuestsController.listGuests` | `manage_guests` | `apps/api/src/guests/guests.module.ts` |
| POST | `/guests` | `GuestsController.createGuest` | `manage_guests` | `apps/api/src/guests/guests.module.ts` |
| PATCH | `/guests/:id` | `GuestsController.updateGuest` | `manage_guests` | `apps/api/src/guests/guests.module.ts` |
| POST | `/guests/:id/anonymize` | `GuestsController.anonymizeGuest` | `manage_guests` | `apps/api/src/guests/guests.module.ts` |
| GET | `/visits` | `GuestsController.listVisits` | `manage_guests` | `apps/api/src/guests/guests.module.ts` |
| POST | `/visits` | `GuestsController.createVisit` | `manage_guests` | `apps/api/src/guests/guests.module.ts` |
| PATCH | `/visits/:id` | `GuestsController.updateVisit` | `manage_guests` | `apps/api/src/guests/guests.module.ts` |
| POST | `/visits/:id/invitations` | `GuestsController.createInvitation` | `manage_guests` | `apps/api/src/guests/guests.module.ts` |

## inventory（13）

| 方法 | 路径 | 处理函数 | 权限 | 文件 |
| --- | --- | --- | --- | --- |
| GET | `/inventory` | `InventoryController.list` | 登录 | `apps/api/src/inventory/inventory.module.ts` |
| GET | `/inventory-batches` | `InventoryController.batches` | 登录 | `apps/api/src/inventory/inventory.module.ts` |
| POST | `/inventory-batches` | `InventoryController.createBatch` | `manage_inventory` | `apps/api/src/inventory/inventory.module.ts` |
| PATCH | `/inventory-batches/:id` | `InventoryController.updateBatch` | `manage_inventory` | `apps/api/src/inventory/inventory.module.ts` |
| POST | `/inventory-items` | `InventoryController.create` | `manage_inventory` | `apps/api/src/inventory/inventory.module.ts` |
| PATCH | `/inventory-items/:id` | `InventoryController.update` | `manage_inventory` | `apps/api/src/inventory/inventory.module.ts` |
| DELETE | `/inventory-items/:id` | `InventoryController.remove` | `manage_inventory` | `apps/api/src/inventory/inventory.module.ts` |
| GET | `/inventory-transactions` | `InventoryController.transactions` | 登录 | `apps/api/src/inventory/inventory.module.ts` |
| POST | `/inventory-transactions/:id/reverse` | `InventoryController.reverse` | `manage_inventory` | `apps/api/src/inventory/inventory.module.ts` |
| POST | `/menus/:id/confirm-consumption` | `InventoryController.confirmMenuConsumption` | `manage_inventory` | `apps/api/src/inventory/inventory.module.ts` |
| GET | `/menus/:id/inventory-preview` | `InventoryController.menuPreview` | 登录 | `apps/api/src/inventory/inventory.module.ts` |
| POST | `/shopping-items/:id/confirm-stock` | `InventoryController.confirmShoppingReceipt` | `manage_inventory` | `apps/api/src/inventory/inventory.module.ts` |
| GET | `/shopping-items/:id/inventory-preview` | `InventoryController.shoppingPreview` | 登录 | `apps/api/src/inventory/inventory.module.ts` |

## knowledge（8）

| 方法 | 路径 | 处理函数 | 权限 | 文件 |
| --- | --- | --- | --- | --- |
| GET | `/knowledge-articles` | `KnowledgeController.list` | 登录 | `apps/api/src/knowledge/knowledge.module.ts` |
| POST | `/knowledge-articles` | `KnowledgeController.create` | 登录 | `apps/api/src/knowledge/knowledge.module.ts` |
| GET | `/knowledge-articles/:id` | `KnowledgeController.detail` | 登录 | `apps/api/src/knowledge/knowledge.module.ts` |
| PATCH | `/knowledge-articles/:id` | `KnowledgeController.update` | 登录 | `apps/api/src/knowledge/knowledge.module.ts` |
| POST | `/knowledge-articles/:id/archive` | `KnowledgeController.archive` | 登录 | `apps/api/src/knowledge/knowledge.module.ts` |
| POST | `/knowledge-articles/:id/restore` | `KnowledgeController.restore` | 登录 | `apps/api/src/knowledge/knowledge.module.ts` |
| GET | `/knowledge-articles/:id/revisions` | `KnowledgeController.revisions` | 登录 | `apps/api/src/knowledge/knowledge.module.ts` |
| POST | `/knowledge-articles/:id/revisions/:version/restore` | `KnowledgeController.restoreRevision` | 登录 | `apps/api/src/knowledge/knowledge.module.ts` |

## media（32）

| 方法 | 路径 | 处理函数 | 权限 | 文件 |
| --- | --- | --- | --- | --- |
| GET | `/media` | `MediaController.list` | 登录 | `apps/api/src/media/media.module.ts` |
| POST | `/media` | `MediaController.create` | 登录 | `apps/api/src/media/media.module.ts` |
| PATCH | `/media/:id` | `MediaController.update` | 登录 | `apps/api/src/media/media.module.ts` |
| DELETE | `/media/:id` | `MediaController.remove` | 登录 | `apps/api/src/media/media.module.ts` |
| POST | `/media/:id/external-refs` | `MediaController.addExternalRefs` | 登录 | `apps/api/src/media/media.module.ts` |
| POST | `/media/:mediaId/requests` | `MediaController.createMediaRequest` | 登录 | `apps/api/src/media/media.module.ts` |
| GET | `/media/connector-settings` | `MediaController.connectorSettings` | `manage_integrations` | `apps/api/src/media/media.module.ts` |
| PUT | `/media/connector-settings/:kind` | `MediaController.updateConnectorSettings` | `manage_integrations` | `apps/api/src/media/media.module.ts` |
| DELETE | `/media/connector-settings/:kind` | `MediaController.resetConnectorSettings` | `manage_integrations` | `apps/api/src/media/media.module.ts` |
| POST | `/media/connector-settings/:kind/test` | `MediaController.testConnectorSettings` | `manage_integrations` | `apps/api/src/media/media.module.ts` |
| POST | `/media/connector-settings/:provider/playback-webhook` | `MediaController.rotatePlaybackWebhook` | `manage_integrations` | `apps/api/src/media/media.module.ts` |
| POST | `/media/connector-settings/moviepilot/webhook` | `MediaController.rotateMoviePilotWebhook` | `manage_integrations` | `apps/api/src/media/media.module.ts` |
| GET | `/media/connectors` | `MediaController.connectors` | 登录 | `apps/api/src/media/media.module.ts` |
| GET | `/media/library` | `MediaController.mediaLibrary` | 登录 | `apps/api/src/media/media.module.ts` |
| POST | `/media/library-availability` | `MediaController.libraryAvailability` | 登录 | `apps/api/src/media/media.module.ts` |
| POST | `/media/library/:libraryItemId/add` | `MediaController.addLibraryItem` | 登录 | `apps/api/src/media/media.module.ts` |
| GET | `/media/library/:libraryItemId/poster` | `MediaController.mediaLibraryPoster` | 公开 | `apps/api/src/media/media.module.ts` |
| POST | `/media/library/sync` | `MediaController.syncMediaLibrary` | `manage_integrations` | `apps/api/src/media/media.module.ts` |
| GET | `/media/metadata-sources` | `MediaController.metadataSources` | `manage_integrations` | `apps/api/src/media/media.module.ts` |
| PUT | `/media/metadata-sources/:provider` | `MediaController.updateMetadataSource` | `manage_integrations` | `apps/api/src/media/media.module.ts` |
| DELETE | `/media/metadata-sources/:provider` | `MediaController.resetMetadataSource` | `manage_integrations` | `apps/api/src/media/media.module.ts` |
| DELETE | `/media/playback-user-mappings/:mappingId` | `MediaController.unmapPlaybackUser` | `manage_integrations` | `apps/api/src/media/media.module.ts` |
| GET | `/media/playback-users` | `MediaController.playbackUsers` | `manage_integrations` | `apps/api/src/media/media.module.ts` |
| PUT | `/media/playback-users/:provider/:externalUserId/mapping` | `MediaController.mapPlaybackUser` | `manage_integrations` | `apps/api/src/media/media.module.ts` |
| GET | `/media/requests` | `MediaController.mediaRequests` | 登录 | `apps/api/src/media/media.module.ts` |
| DELETE | `/media/requests/:requestId` | `MediaController.cancelMediaRequest` | 登录 | `apps/api/src/media/media.module.ts` |
| POST | `/media/requests/:requestId/refresh` | `MediaController.refreshMediaRequest` | 登录 | `apps/api/src/media/media.module.ts` |
| GET | `/media/search` | `MediaController.search` | 登录 | `apps/api/src/media/media.module.ts` |
| GET | `/media/viewing-progress` | `MediaController.viewingProgress` | 登录 | `apps/api/src/media/media.module.ts` |
| GET | `/media/viewing-sessions` | `MediaController.viewingSessions` | 登录 | `apps/api/src/media/media.module.ts` |
| POST | `/media/webhooks/moviepilot/:integrationId/:secret` | `MediaController.receiveMoviePilotWebhook` | 公开 | `apps/api/src/media/media.module.ts` |
| POST | `/media/webhooks/playback/:provider/:integrationId/:secret` | `MediaController.AnyFilesInterceptor` | 公开 | `apps/api/src/media/media.module.ts` |

## memories（8）

| 方法 | 路径 | 处理函数 | 权限 | 文件 |
| --- | --- | --- | --- | --- |
| GET | `/memories` | `MemoriesController.list` | 登录 | `apps/api/src/memories/memories.module.ts` |
| POST | `/memories` | `MemoriesController.create` | 登录 | `apps/api/src/memories/memories.module.ts` |
| GET | `/memories/:id` | `MemoriesController.detail` | 登录 | `apps/api/src/memories/memories.module.ts` |
| PATCH | `/memories/:id` | `MemoriesController.update` | 登录 | `apps/api/src/memories/memories.module.ts` |
| POST | `/memories/:id/archive` | `MemoriesController.archive` | 登录 | `apps/api/src/memories/memories.module.ts` |
| POST | `/memories/:id/photos` | `MemoriesController.FileInterceptor` | 登录 | `apps/api/src/memories/memories.module.ts` |
| POST | `/memories/:id/restore` | `MemoriesController.restore` | 登录 | `apps/api/src/memories/memories.module.ts` |
| GET | `/memories/:memoryId/photos/:photoId/content` | `MemoriesController.photoContent` | 公开 | `apps/api/src/memories/memories.module.ts` |

## menus（9）

| 方法 | 路径 | 处理函数 | 权限 | 文件 |
| --- | --- | --- | --- | --- |
| GET | `/menu-dates` | `MenusController.dateCounts` | 登录 | `apps/api/src/menus/menus.module.ts` |
| PATCH | `/menu-items/:id` | `MenusController.updateItem` | 登录 | `apps/api/src/menus/menus.module.ts` |
| GET | `/menu-notifications` | `MenusController.notifications` | 登录 | `apps/api/src/menus/menus.module.ts` |
| PATCH | `/menu-notifications/:id/read` | `MenusController.markNotificationRead` | 登录 | `apps/api/src/menus/menus.module.ts` |
| GET | `/menus` | `MenusController.get` | 登录 | `apps/api/src/menus/menus.module.ts` |
| PATCH | `/menus/:id/chef` | `MenusController.assignChef` | `update_meal_status` | `apps/api/src/menus/menus.module.ts` |
| POST | `/menus/:id/complete` | `MenusController.complete` | `update_meal_status` | `apps/api/src/menus/menus.module.ts` |
| GET | `/menus/:id/events` | `MenusController.events` | 登录 | `apps/api/src/menus/menus.module.ts` |
| POST | `/menus/:id/items` | `MenusController.addItems` | `place_meal_order` | `apps/api/src/menus/menus.module.ts` |

## notifications（11）

| 方法 | 路径 | 处理函数 | 权限 | 文件 |
| --- | --- | --- | --- | --- |
| GET | `/notification-channels` | `ExternalNotificationsController.listChannels` | 登录 | `apps/api/src/notifications/external-notifications.controller.ts` |
| POST | `/notification-channels` | `ExternalNotificationsController.createChannel` | `manage_integrations` | `apps/api/src/notifications/external-notifications.controller.ts` |
| PATCH | `/notification-channels/:id` | `ExternalNotificationsController.updateChannel` | `manage_integrations` | `apps/api/src/notifications/external-notifications.controller.ts` |
| DELETE | `/notification-channels/:id` | `ExternalNotificationsController.deleteChannel` | `manage_integrations` | `apps/api/src/notifications/external-notifications.controller.ts` |
| PUT | `/notification-channels/:id/preference` | `ExternalNotificationsController.updatePreference` | 登录 | `apps/api/src/notifications/external-notifications.controller.ts` |
| POST | `/notification-channels/:id/test` | `ExternalNotificationsController.testChannel` | `manage_integrations` | `apps/api/src/notifications/external-notifications.controller.ts` |
| GET | `/notification-deliveries` | `ExternalNotificationsController.listDeliveries` | 登录 | `apps/api/src/notifications/external-notifications.controller.ts` |
| POST | `/notification-deliveries/:id/retry` | `ExternalNotificationsController.retryDelivery` | 登录 | `apps/api/src/notifications/external-notifications.controller.ts` |
| GET | `/notifications` | `NotificationsController.list` | 登录 | `apps/api/src/notifications/notifications.module.ts` |
| PATCH | `/notifications/:id/read` | `NotificationsController.markRead` | 登录 | `apps/api/src/notifications/notifications.module.ts` |
| PATCH | `/notifications/read-all` | `NotificationsController.markAllRead` | 登录 | `apps/api/src/notifications/notifications.module.ts` |

## points（12）

| 方法 | 路径 | 处理函数 | 权限 | 文件 |
| --- | --- | --- | --- | --- |
| GET | `/points/accounts` | `PointsController.accounts` | 登录 | `apps/api/src/points/points.module.ts` |
| POST | `/points/adjustments` | `PointsController.adjust` | `manage_points` | `apps/api/src/points/points.module.ts` |
| GET | `/points/ledger` | `PointsController.ledger` | 登录 | `apps/api/src/points/points.module.ts` |
| POST | `/points/ledger/:id/reverse` | `PointsController.reverseLedger` | `manage_points` | `apps/api/src/points/points.module.ts` |
| GET | `/reward-redemptions` | `PointsController.redemptions` | 登录 | `apps/api/src/points/points.module.ts` |
| POST | `/reward-redemptions/:id/cancel` | `PointsController.cancel` | 登录 | `apps/api/src/points/points.module.ts` |
| POST | `/reward-redemptions/:id/decision` | `PointsController.decide` | `manage_points` | `apps/api/src/points/points.module.ts` |
| POST | `/reward-redemptions/:id/reverse` | `PointsController.reverseRedemption` | `manage_points` | `apps/api/src/points/points.module.ts` |
| GET | `/rewards` | `PointsController.rewards` | 登录 | `apps/api/src/points/points.module.ts` |
| POST | `/rewards` | `PointsController.createReward` | `manage_points` | `apps/api/src/points/points.module.ts` |
| PATCH | `/rewards/:id` | `PointsController.updateReward` | `manage_points` | `apps/api/src/points/points.module.ts` |
| POST | `/rewards/:id/redemptions` | `PointsController.redeem` | 登录 | `apps/api/src/points/points.module.ts` |

## polls（8）

| 方法 | 路径 | 处理函数 | 权限 | 文件 |
| --- | --- | --- | --- | --- |
| GET | `/polls` | `PollsController.list` | 登录 | `apps/api/src/polls/polls.module.ts` |
| POST | `/polls` | `PollsController.create` | 登录 | `apps/api/src/polls/polls.module.ts` |
| GET | `/polls/:id` | `PollsController.get` | 登录 | `apps/api/src/polls/polls.module.ts` |
| PATCH | `/polls/:id` | `PollsController.update` | 登录 | `apps/api/src/polls/polls.module.ts` |
| DELETE | `/polls/:id` | `PollsController.archive` | 登录 | `apps/api/src/polls/polls.module.ts` |
| POST | `/polls/:id/close` | `PollsController.close` | 登录 | `apps/api/src/polls/polls.module.ts` |
| POST | `/polls/:id/reopen` | `PollsController.reopen` | 登录 | `apps/api/src/polls/polls.module.ts` |
| POST | `/polls/:id/votes` | `PollsController.vote` | 登录 | `apps/api/src/polls/polls.module.ts` |

## recipes（7）

| 方法 | 路径 | 处理函数 | 权限 | 文件 |
| --- | --- | --- | --- | --- |
| POST | `/dishes/:dishId/recipe-variants` | `RecipesController.createVariant` | 登录 | `apps/api/src/recipes/recipes.module.ts` |
| POST | `/member-dish-skills` | `RecipesController.upsertSkill` | 登录 | `apps/api/src/recipes/recipes.module.ts` |
| DELETE | `/members/:memberId/dish-skills/:dishId` | `RecipesController.removeSkill` | 登录 | `apps/api/src/recipes/recipes.module.ts` |
| PATCH | `/recipe-variants/:id` | `RecipesController.updateVariant` | 登录 | `apps/api/src/recipes/recipes.module.ts` |
| DELETE | `/recipe-variants/:id` | `RecipesController.archiveVariant` | 登录 | `apps/api/src/recipes/recipes.module.ts` |
| GET | `/recipes` | `RecipesController.list` | 登录 | `apps/api/src/recipes/recipes.module.ts` |
| GET | `/recipes/:dishId` | `RecipesController.get` | 登录 | `apps/api/src/recipes/recipes.module.ts` |

## reminders（5）

| 方法 | 路径 | 处理函数 | 权限 | 文件 |
| --- | --- | --- | --- | --- |
| GET | `/reminder-sources` | `RemindersController.listSources` | 登录 | `apps/api/src/reminders/reminders.module.ts` |
| GET | `/reminders` | `RemindersController.list` | 登录 | `apps/api/src/reminders/reminders.module.ts` |
| POST | `/reminders` | `RemindersController.create` | 登录 | `apps/api/src/reminders/reminders.module.ts` |
| PATCH | `/reminders/:id` | `RemindersController.update` | 登录 | `apps/api/src/reminders/reminders.module.ts` |
| DELETE | `/reminders/:id` | `RemindersController.cancel` | 登录 | `apps/api/src/reminders/reminders.module.ts` |

## shopping（5）

| 方法 | 路径 | 处理函数 | 权限 | 文件 |
| --- | --- | --- | --- | --- |
| POST | `/shopping-items` | `ShoppingController.addManual` | `manage_shopping` | `apps/api/src/shopping/shopping.module.ts` |
| PATCH | `/shopping-items/:id` | `ShoppingController.check` | `manage_shopping` | `apps/api/src/shopping/shopping.module.ts` |
| DELETE | `/shopping-items/:id` | `ShoppingController.remove` | `manage_shopping` | `apps/api/src/shopping/shopping.module.ts` |
| GET | `/shopping-list` | `ShoppingController.list` | 登录 | `apps/api/src/shopping/shopping.module.ts` |
| POST | `/shopping-list/generate` | `ShoppingController.generate` | `manage_shopping` | `apps/api/src/shopping/shopping.module.ts` |

## smart-menu（4）

| 方法 | 路径 | 处理函数 | 权限 | 文件 |
| --- | --- | --- | --- | --- |
| GET | `/smart-menu-plans` | `SmartMenuController.list` | 登录 | `apps/api/src/smart-menu/smart-menu.module.ts` |
| POST | `/smart-menu-plans` | `SmartMenuController.create` | `place_meal_order` | `apps/api/src/smart-menu/smart-menu.module.ts` |
| POST | `/smart-menu-plans/:id/adopt` | `SmartMenuController.adopt` | `place_meal_order` | `apps/api/src/smart-menu/smart-menu.module.ts` |
| POST | `/smart-menu-plans/:id/poll` | `SmartMenuController.createPoll` | `place_meal_order` | `apps/api/src/smart-menu/smart-menu.module.ts` |

## system（8）

| 方法 | 路径 | 处理函数 | 权限 | 文件 |
| --- | --- | --- | --- | --- |
| GET | `/health/live` | `HealthController.live` | 公开 | `apps/api/src/system/system.module.ts` |
| GET | `/health/ready` | `HealthController.ready` | 公开 | `apps/api/src/system/system.module.ts` |
| GET | `/system/backups` | `SystemBackupController.dashboard` | 登录 | `apps/api/src/system/system.module.ts` |
| POST | `/system/backups/capacity-checks` | `SystemBackupController.queueCapacityCheck` | 登录 | `apps/api/src/system/system.module.ts` |
| PUT | `/system/backups/policy` | `SystemBackupController.updatePolicy` | 登录 | `apps/api/src/system/system.module.ts` |
| POST | `/system/backups/runs` | `SystemBackupController.queueBackup` | 登录 | `apps/api/src/system/system.module.ts` |
| PATCH | `/system/backups/runs/:id/cancel` | `SystemBackupController.cancelRun` | 登录 | `apps/api/src/system/system.module.ts` |
| POST | `/system/backups/runs/:id/restore-drills` | `SystemBackupController.queueRestoreDrill` | 登录 | `apps/api/src/system/system.module.ts` |

## tasks（5）

| 方法 | 路径 | 处理函数 | 权限 | 文件 |
| --- | --- | --- | --- | --- |
| GET | `/tasks` | `TasksController.list` | 登录 | `apps/api/src/tasks/tasks.module.ts` |
| POST | `/tasks` | `TasksController.create` | 登录 | `apps/api/src/tasks/tasks.module.ts` |
| PATCH | `/tasks/:id` | `TasksController.update` | 登录 | `apps/api/src/tasks/tasks.module.ts` |
| DELETE | `/tasks/:id` | `TasksController.archive` | 登录 | `apps/api/src/tasks/tasks.module.ts` |
| PATCH | `/tasks/:taskId/instances/:dueDate` | `TasksController.updateOccurrence` | 登录 | `apps/api/src/tasks/tasks.module.ts` |

## travel（21）

| 方法 | 路径 | 处理函数 | 权限 | 文件 |
| --- | --- | --- | --- | --- |
| GET | `/travel-plans` | `TravelController.listPlans` | 登录 | `apps/api/src/travel/travel.module.ts` |
| POST | `/travel-plans` | `TravelController.createPlan` | 登录 | `apps/api/src/travel/travel.module.ts` |
| GET | `/travel-plans/:id` | `TravelController.detail` | 登录 | `apps/api/src/travel/travel.module.ts` |
| PATCH | `/travel-plans/:id` | `TravelController.updatePlan` | 登录 | `apps/api/src/travel/travel.module.ts` |
| POST | `/travel-plans/:id/archive` | `TravelController.archivePlan` | 登录 | `apps/api/src/travel/travel.module.ts` |
| POST | `/travel-plans/:id/cancel` | `TravelController.cancelPlan` | 登录 | `apps/api/src/travel/travel.module.ts` |
| POST | `/travel-plans/:id/complete` | `TravelController.completePlan` | 登录 | `apps/api/src/travel/travel.module.ts` |
| POST | `/travel-plans/:id/reopen` | `TravelController.reopenPlan` | 登录 | `apps/api/src/travel/travel.module.ts` |
| POST | `/travel-plans/:id/restore` | `TravelController.restorePlan` | 登录 | `apps/api/src/travel/travel.module.ts` |
| POST | `/travel-plans/:planId/items` | `TravelController.createItem` | 登录 | `apps/api/src/travel/travel.module.ts` |
| PATCH | `/travel-plans/:planId/items/:itemId` | `TravelController.updateItem` | 登录 | `apps/api/src/travel/travel.module.ts` |
| POST | `/travel-plans/:planId/items/:itemId/archive` | `TravelController.archiveItem` | 登录 | `apps/api/src/travel/travel.module.ts` |
| POST | `/travel-plans/:planId/items/:itemId/complete` | `TravelController.completeItem` | 登录 | `apps/api/src/travel/travel.module.ts` |
| POST | `/travel-plans/:planId/items/:itemId/restore` | `TravelController.restoreItem` | 登录 | `apps/api/src/travel/travel.module.ts` |
| POST | `/travel-plans/:planId/items/:itemId/skip` | `TravelController.skipItem` | 登录 | `apps/api/src/travel/travel.module.ts` |
| POST | `/travel-plans/:planId/templates/:templateId/apply` | `TravelController.applyTemplate` | 登录 | `apps/api/src/travel/travel.module.ts` |
| GET | `/travel-templates` | `TravelController.listTemplates` | 登录 | `apps/api/src/travel/travel.module.ts` |
| POST | `/travel-templates` | `TravelController.createTemplate` | 登录 | `apps/api/src/travel/travel.module.ts` |
| PATCH | `/travel-templates/:id` | `TravelController.updateTemplate` | 登录 | `apps/api/src/travel/travel.module.ts` |
| POST | `/travel-templates/:id/archive` | `TravelController.archiveTemplate` | 登录 | `apps/api/src/travel/travel.module.ts` |
| POST | `/travel-templates/:id/restore` | `TravelController.restoreTemplate` | 登录 | `apps/api/src/travel/travel.module.ts` |

## upload（1）

| 方法 | 路径 | 处理函数 | 权限 | 文件 |
| --- | --- | --- | --- | --- |
| POST | `/upload` | `UploadController.FileInterceptor` | 登录 | `apps/api/src/upload/upload.module.ts` |

