import { BadRequestException } from '@nestjs/common';
import type {
  ExternalAccessAccessScope,
  ExternalAccessCredentialKind,
  ExternalAccessMode,
  ExternalAccessSettings,
  TestExternalAccessSettingsBody,
  UpdateExternalAccessSettingsBody,
} from '@family/contracts';
import { integrationCredentialHint } from '../common/integration-credentials';
import type { Integration } from '../entities';
import type { TailscaleTarget } from './tailscale.client';
import {
  DEFAULT_TAILSCALE_API_BASE_URL,
  DEFAULT_TAILSCALE_NODE_HOSTNAME,
  DEFAULT_TAILSCALE_TAILNET,
  isPublicUrlCorsMatched,
  maskOauthClientId,
  normalizeNodeHostname,
  normalizeTailnet,
  normalizeTailscaleBaseUrl,
  normalizeTailscalePublicUrl,
  type TailscaleServerDefault,
} from './tailscale.config';

export interface StoredTailscaleSettings {
  tailnet?: string;
  publicUrl?: string | null;
  nodeHostname?: string | null;
  credentialKind?: ExternalAccessCredentialKind;
  oauthClientId?: string | null;
}

export interface ResolvedTailscaleAccess {
  mode: ExternalAccessMode;
  accessScope: ExternalAccessAccessScope;
  accessMessage: string | null;
  target: TailscaleTarget | null;
  publicUrl: string | null;
  nodeHostname: string | null;
  version: string;
}

export function readStoredTailscaleSettings(
  raw: Record<string, unknown> | null | undefined,
): StoredTailscaleSettings {
  const input = raw && typeof raw === 'object' ? raw : {};
  const kind =
    input.credentialKind === 'oauth_client' || input.credentialKind === 'api_token'
      ? input.credentialKind
      : undefined;
  return {
    tailnet: typeof input.tailnet === 'string' ? input.tailnet : undefined,
    publicUrl: typeof input.publicUrl === 'string' ? input.publicUrl : null,
    nodeHostname: typeof input.nodeHostname === 'string' ? input.nodeHostname : null,
    credentialKind: kind,
    oauthClientId: typeof input.oauthClientId === 'string' ? input.oauthClientId : null,
  };
}

function hasUsableHouseholdCredential(
  kind: ExternalAccessCredentialKind | null,
  oauthClientId: string | null,
  credentialConfigured: boolean,
): boolean {
  if (!credentialConfigured || !kind) return false;
  if (kind === 'oauth_client') return Boolean(oauthClientId);
  return true;
}

export function presentHouseholdTailscaleSettings(row: Integration): ExternalAccessSettings {
  const stored = readStoredTailscaleSettings(row.settings);
  const credentialKind = stored.credentialKind ?? 'oauth_client';
  const credentialConfigured = Boolean(row.secret?.credentialHint);
  const oauthClientId = credentialKind === 'oauth_client' ? (stored.oauthClientId ?? null) : null;
  const publicUrl = stored.publicUrl ?? null;
  const baseUrl = row.baseUrl ?? DEFAULT_TAILSCALE_API_BASE_URL;
  const tailnet = stored.tailnet ?? DEFAULT_TAILSCALE_TAILNET;
  const configured = Boolean(
    row.isEnabled &&
      baseUrl &&
      tailnet &&
      hasUsableHouseholdCredential(credentialKind, oauthClientId, credentialConfigured),
  );
  return {
    mode: 'household',
    accessScope: 'household',
    accessMessage: null,
    isEnabled: row.isEnabled,
    baseUrl,
    tailnet,
    publicUrl,
    nodeHostname: stored.nodeHostname ?? DEFAULT_TAILSCALE_NODE_HOSTNAME,
    credentialKind,
    oauthClientIdHint: maskOauthClientId(oauthClientId),
    credentialConfigured,
    credentialHint: row.secret?.credentialHint ?? null,
    configured,
    corsOriginMatched: isPublicUrlCorsMatched(publicUrl),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function presentRestrictedTailscaleSettings(
  accessMessage: string | null,
): ExternalAccessSettings {
  return {
    mode: 'server_default',
    accessScope: 'restricted',
    accessMessage,
    isEnabled: false,
    baseUrl: null,
    tailnet: null,
    publicUrl: null,
    nodeHostname: null,
    credentialKind: null,
    oauthClientIdHint: null,
    credentialConfigured: false,
    credentialHint: null,
    configured: false,
    corsOriginMatched: null,
    updatedAt: null,
  };
}

export function presentServerDefaultTailscaleSettings(
  fallback: TailscaleServerDefault,
): ExternalAccessSettings {
  const credentialConfigured = Boolean(fallback.credentialKind && fallback.secret);
  return {
    mode: 'server_default',
    accessScope: 'server_default',
    accessMessage: null,
    isEnabled: true,
    baseUrl: fallback.baseUrl,
    tailnet: fallback.tailnet,
    publicUrl: fallback.publicUrl,
    nodeHostname: fallback.nodeHostname,
    credentialKind: fallback.credentialKind,
    oauthClientIdHint: maskOauthClientId(fallback.oauthClientId),
    credentialConfigured,
    credentialHint: credentialConfigured ? '服务器默认' : null,
    configured: credentialConfigured,
    corsOriginMatched: isPublicUrlCorsMatched(fallback.publicUrl),
    updatedAt: null,
  };
}

export function resolveHouseholdTailscaleAccess(
  row: Integration,
  secret: string | null,
): ResolvedTailscaleAccess {
  const stored = readStoredTailscaleSettings(row.settings);
  const credentialKind = stored.credentialKind ?? 'oauth_client';
  const oauthClientId = credentialKind === 'oauth_client' ? (stored.oauthClientId ?? null) : null;
  const baseUrl = row.baseUrl ?? DEFAULT_TAILSCALE_API_BASE_URL;
  const tailnet = stored.tailnet ?? DEFAULT_TAILSCALE_TAILNET;
  const usable = Boolean(
    row.isEnabled &&
      baseUrl &&
      tailnet &&
      secret &&
      (credentialKind === 'api_token' || Boolean(oauthClientId)),
  );
  return {
    mode: 'household',
    accessScope: 'household',
    accessMessage: null,
    target: usable
      ? { baseUrl, tailnet, credentialKind, oauthClientId, secret: secret! }
      : null,
    publicUrl: stored.publicUrl ?? null,
    nodeHostname: stored.nodeHostname ?? DEFAULT_TAILSCALE_NODE_HOSTNAME,
    version: `household:${row.updatedAt.getTime()}:${row.secret?.updatedAt.getTime() ?? 0}`,
  };
}

export function resolveRestrictedTailscaleAccess(
  accessMessage: string | null,
): ResolvedTailscaleAccess {
  return {
    mode: 'server_default',
    accessScope: 'restricted',
    accessMessage,
    target: null,
    publicUrl: null,
    nodeHostname: null,
    version: 'restricted',
  };
}

export function resolveServerDefaultTailscaleAccess(
  fallback: TailscaleServerDefault,
): ResolvedTailscaleAccess {
  const usable = Boolean(fallback.credentialKind && fallback.secret);
  return {
    mode: 'server_default',
    accessScope: 'server_default',
    accessMessage: null,
    target: usable
      ? {
          baseUrl: fallback.baseUrl,
          tailnet: fallback.tailnet,
          credentialKind: fallback.credentialKind!,
          oauthClientId: fallback.oauthClientId,
          secret: fallback.secret!,
        }
      : null,
    publicUrl: fallback.publicUrl,
    nodeHostname: fallback.nodeHostname,
    version: [
      'server',
      fallback.baseUrl,
      fallback.tailnet,
      fallback.credentialKind ?? '',
      fallback.secret ? integrationCredentialHint(fallback.secret) : '',
    ].join(':'),
  };
}

export interface NormalizedTailscaleUpdate {
  baseUrl: string;
  tailnet: string;
  publicUrl: string | null;
  nodeHostname: string;
  isEnabled: boolean;
  credentialKind: ExternalAccessCredentialKind;
  oauthClientId: string | null;
  incomingCredential: string | undefined;
}

export function resolveDraftTailscaleTarget(
  current: ResolvedTailscaleAccess,
  draft: TestExternalAccessSettingsBody,
): {
  accessScope: ExternalAccessAccessScope;
  accessMessage: string | null;
  target: TailscaleTarget | null;
  nodeHostname: string | null;
} {
  const hasInlineSecret = Boolean(draft.credential?.trim());
  if (current.accessScope === 'restricted' && !hasInlineSecret) {
    return {
      accessScope: 'restricted',
      accessMessage: current.accessMessage,
      target: null,
      nodeHostname: null,
    };
  }

  const baseUrl = normalizeTailscaleBaseUrl(
    draft.baseUrl !== undefined ? draft.baseUrl : current.target?.baseUrl,
  );
  if (!baseUrl) {
    throw new BadRequestException('控制面地址必须是有效的 HTTPS 地址，不能带用户名密码或回环地址');
  }
  const tailnet = normalizeTailnet(
    draft.tailnet !== undefined ? draft.tailnet : current.target?.tailnet,
  );
  if (!tailnet) {
    throw new BadRequestException('tailnet 名称格式无效，留空或填 - 使用默认 tailnet');
  }
  const nodeHostname =
    draft.nodeHostname !== undefined
      ? normalizeNodeHostname(draft.nodeHostname)
      : current.nodeHostname ?? DEFAULT_TAILSCALE_NODE_HOSTNAME;
  if (nodeHostname === undefined) {
    throw new BadRequestException('节点名称不能超过 120 个字符');
  }

  if (current.target && baseUrl !== current.target.baseUrl && !hasInlineSecret) {
    throw new BadRequestException('修改控制面地址时请重新填写凭据');
  }

  const credentialKind: ExternalAccessCredentialKind =
    draft.credentialKind ?? current.target?.credentialKind ?? 'oauth_client';
  const canReuseStored = Boolean(
    current.target &&
      baseUrl === current.target.baseUrl &&
      credentialKind === current.target.credentialKind,
  );
  const oauthClientId =
    credentialKind === 'oauth_client'
      ? (draft.oauthClientId !== undefined
          ? draft.oauthClientId?.trim() || null
          : canReuseStored
            ? current.target?.oauthClientId ?? null
            : null)
      : null;
  const secret = hasInlineSecret
    ? draft.credential!.trim()
    : canReuseStored
      ? current.target?.secret ?? null
      : null;
  const accessScope = current.accessScope === 'restricted' ? 'household' : current.accessScope;

  if (!secret || (credentialKind === 'oauth_client' && !oauthClientId)) {
    return { accessScope, accessMessage: null, target: null, nodeHostname };
  }
  return {
    accessScope,
    accessMessage: null,
    target: { baseUrl, tailnet, credentialKind, oauthClientId, secret },
    nodeHostname,
  };
}

export function normalizeTailscaleUpdateInput(
  input: UpdateExternalAccessSettingsBody,
  existing: Integration | null,
  fallback: TailscaleServerDefault,
  allowFallbackDefaults: boolean,
): NormalizedTailscaleUpdate {
  const existingStored = readStoredTailscaleSettings(existing?.settings);
  const baseUrl = normalizeTailscaleBaseUrl(
    input.baseUrl !== undefined
      ? input.baseUrl
      : existing?.baseUrl ?? (allowFallbackDefaults ? fallback.baseUrl : DEFAULT_TAILSCALE_API_BASE_URL),
  );
  if (!baseUrl) {
    throw new BadRequestException('控制面地址必须是有效的 HTTPS 地址，不能带用户名密码或回环地址');
  }
  const tailnet = normalizeTailnet(
    input.tailnet !== undefined
      ? input.tailnet
      : existingStored.tailnet ?? (allowFallbackDefaults ? fallback.tailnet : DEFAULT_TAILSCALE_TAILNET),
  );
  if (!tailnet) {
    throw new BadRequestException('tailnet 名称格式无效，留空或填 - 使用默认 tailnet');
  }
  const publicUrl = normalizeTailscalePublicUrl(
    input.publicUrl !== undefined
      ? input.publicUrl
      : existingStored.publicUrl ?? (allowFallbackDefaults ? fallback.publicUrl : null),
  );
  if (publicUrl === undefined) {
    throw new BadRequestException('私有入口地址必须是完整的 https:// 域名，不带路径或查询参数');
  }
  const defaultNodeHostname = allowFallbackDefaults
    ? fallback.nodeHostname
    : DEFAULT_TAILSCALE_NODE_HOSTNAME;
  const nodeHostname = normalizeNodeHostname(
    input.nodeHostname !== undefined
      ? input.nodeHostname
      : existingStored.nodeHostname ?? defaultNodeHostname,
  );
  if (nodeHostname === undefined) {
    throw new BadRequestException('节点名称不能超过 120 个字符');
  }

  const isEnabled = input.isEnabled ?? existing?.isEnabled ?? true;
  const credentialKind: ExternalAccessCredentialKind =
    input.credentialKind ?? existingStored.credentialKind ?? 'oauth_client';
  const oauthClientId =
    credentialKind === 'oauth_client'
      ? (input.oauthClientId !== undefined
          ? input.oauthClientId?.trim() || null
          : existingStored.oauthClientId ?? null)
      : null;

  let incomingCredential: string | undefined;
  if (input.credential !== undefined) {
    incomingCredential = input.credential.trim();
    if (incomingCredential.length < 12) {
      throw new BadRequestException('控制面凭据太短，像是没有复制完整');
    }
  }

  return {
    baseUrl,
    tailnet,
    publicUrl,
    nodeHostname: nodeHostname ?? DEFAULT_TAILSCALE_NODE_HOSTNAME,
    isEnabled,
    credentialKind,
    oauthClientId,
    incomingCredential,
  };
}

