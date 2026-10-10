import { quirksFor } from '@family/agent-core';
import type { JwtUser } from '../auth/jwt.guard';
import type { AgentSetting } from '../entities';
import { settingProviderConfig } from './native/provider-factory';

/**
 * 看图（截图记账，J4 第四批）对这个成员开没开：第 2 档开着（enabled）、「测一下」通过、配置齐全且 key 解得开、
 * 配的服务商收图片（agent-core 的差异表；DeepSeek 不收），并且第 2 档对他开放（tier2Scope = all 或他是管理员）。
 * 与运行方式无关：家里仍用本地摘要回答对话时，只要云端模型配好测通，截图识别照样能用。
 */
export function visionAvailable(setting: AgentSetting, user: Pick<JwtUser, 'role'>) {
  if (!setting.enabled || !setting.providerCheckOk) return false;
  if (setting.tier2Scope !== 'all' && user.role === 'member') return false;
  const config = settingProviderConfig(setting);
  return config != null && quirksFor(config.quirks).images;
}
