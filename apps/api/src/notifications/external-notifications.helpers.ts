import { BadRequestException } from '@nestjs/common';
import {
  MemberNotificationPreference,
  NotificationChannel,
  NotificationChannelKind,
  NotificationModule,
} from '../entities';

export const ALL_NOTIFICATION_MODULES: NotificationModule[] = [
  'menu',
  'task',
  'poll',
  'calendar',
  'reminder',
  'media',
  'guest',
  'points',
  'agent',
  'system',
];

export const AUTO_ATTEMPTS = 4;

export interface CreateNotificationChannelInput {
  name: string;
  kind: NotificationChannelKind;
  endpoint: string;
  credential?: string;
  isEnabled?: boolean;
}

export interface UpdateNotificationChannelInput {
  name?: string;
  kind?: NotificationChannelKind;
  endpoint?: string;
  credential?: string;
  clearCredential?: boolean;
  isEnabled?: boolean;
}

export interface UpdateNotificationPreferenceInput {
  isEnabled: boolean;
  modules: NotificationModule[];
}

export function normalizedName(value: string) {
  const name = value.trim();
  if (!name || name.length > 120) {
    throw new BadRequestException('渠道名称需要填写且不能超过 120 字');
  }
  return name;
}

export function normalizedEndpoint(value: string) {
  const endpoint = value.trim();
  if (endpoint.length > 2000) {
    throw new BadRequestException('渠道地址不能超过 2000 字');
  }
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    throw new BadRequestException('渠道地址必须是完整的 HTTP 或 HTTPS 地址');
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new BadRequestException('渠道地址只支持 HTTP 或 HTTPS');
  }
  if (url.username || url.password) {
    throw new BadRequestException('渠道地址不能包含用户名或密码');
  }
  url.hash = '';
  return {
    value: url.toString(),
    hint: `${url.protocol}//${url.host}`,
  };
}

export function normalizedCredential(value: string) {
  const credential = value.trim();
  if (credential.length < 4 || credential.length > 2000) {
    throw new BadRequestException('渠道凭据长度需要在 4 到 2000 字之间');
  }
  return credential;
}

export function channelView(
  channel: NotificationChannel,
  preference?: MemberNotificationPreference,
) {
  return {
    id: channel.id,
    householdId: channel.householdId,
    name: channel.name,
    kind: channel.kind,
    endpointHint: channel.endpointHint,
    credentialConfigured: Boolean(channel.credentialHint),
    credentialHint: channel.credentialHint,
    isEnabled: channel.isEnabled,
    createdBy: channel.createdBy,
    lastTestedAt: channel.lastTestedAt,
    lastTestStatus: channel.lastTestStatus,
    lastTestError: channel.lastTestError,
    preference: preference
      ? {
          id: preference.id,
          isEnabled: preference.isEnabled,
          modules: preference.modules,
          updatedAt: preference.updatedAt,
        }
      : {
          id: null,
          isEnabled: false,
          modules: ALL_NOTIFICATION_MODULES,
          updatedAt: null,
        },
    createdAt: channel.createdAt,
    updatedAt: channel.updatedAt,
  };
}
