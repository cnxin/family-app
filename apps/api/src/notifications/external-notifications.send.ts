import { decryptIntegrationCredential } from '../common/integration-credentials';
import { NotificationChannel, NotificationModule } from '../entities';

export interface SendResult {
  success: boolean;
  retryable: boolean;
  httpStatus: number | null;
  errorCode: string | null;
  errorMessage: string | null;
  startedAt: Date;
  finishedAt: Date;
}

export async function sendToChannel(
  channel: NotificationChannel,
  payload: {
    event: string;
    deliveryId: string;
    notification: {
      id: string | null;
      module: NotificationModule;
      type: string;
      title: string;
      body: string | null;
      targetPath: string;
      createdAt: string;
    };
    recipient: { id: string; name: string };
  },
  idempotencyKey: string,
): Promise<SendResult> {
  const startedAt = new Date();
  if (!channel.isEnabled) return configurationFailure('通知渠道已停用');
  let endpoint: string;
  let credential: string | null;
  try {
    endpoint = decryptIntegrationCredential(
      channel.endpointEncrypted,
      channel.householdId,
      `notification-channel:${channel.id}:endpoint`,
      '通知渠道地址',
    )!;
    credential = decryptIntegrationCredential(
      channel.credentialEncrypted,
      channel.householdId,
      `notification-channel:${channel.id}:credential`,
      '通知渠道',
    );
  } catch {
    return configurationFailure('通知渠道配置无法解密', startedAt);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), requestTimeoutMs());
  try {
    const body =
      channel.kind === 'ntfy'
        ? {
            title: payload.notification.title,
            message: [payload.notification.body, payload.notification.targetPath]
              .filter(Boolean)
              .join('\n'),
          }
        : payload;
    const response = await fetch(endpoint, {
      method: 'POST',
      redirect: 'error',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': idempotencyKey,
        'X-Family-Notification-Event': payload.event,
        ...(credential ? { Authorization: `Bearer ${credential}` } : {}),
      },
      body: JSON.stringify(body),
    });
    await response.body?.cancel();
    const finishedAt = new Date();
    if (response.ok) {
      return {
        success: true,
        retryable: false,
        httpStatus: response.status,
        errorCode: null,
        errorMessage: null,
        startedAt,
        finishedAt,
      };
    }
    const retryable =
      response.status >= 500 ||
      [408, 409, 425, 429].includes(response.status);
    return {
      success: false,
      retryable,
      httpStatus: response.status,
      errorCode: `HTTP_${response.status}`,
      errorMessage: `外部服务返回 HTTP ${response.status}`,
      startedAt,
      finishedAt,
    };
  } catch (error) {
    const timedOut = error instanceof Error && error.name === 'AbortError';
    return {
      success: false,
      retryable: true,
      httpStatus: null,
      errorCode: timedOut ? 'TIMEOUT' : 'NETWORK_ERROR',
      errorMessage: timedOut ? '外部服务响应超时' : '无法连接外部服务',
      startedAt,
      finishedAt: new Date(),
    };
  } finally {
    clearTimeout(timeout);
  }
}

export function configurationFailure(message: string, startedAt = new Date()) {
  return {
    success: false,
    retryable: false,
    httpStatus: null,
    errorCode: 'CONFIGURATION_ERROR',
    errorMessage: message,
    startedAt,
    finishedAt: new Date(),
  } satisfies SendResult;
}

function requestTimeoutMs() {
  const configured = Number(
    process.env.NOTIFICATION_DELIVERY_TIMEOUT_MS || 5_000,
  );
  return Number.isFinite(configured)
    ? Math.max(100, Math.min(configured, 30_000))
    : 5_000;
}

export function retryBaseMs() {
  const configured = Number(
    process.env.NOTIFICATION_DELIVERY_RETRY_BASE_MS || 60_000,
  );
  return Number.isFinite(configured)
    ? Math.max(100, Math.min(configured, 30 * 60_000))
    : 60_000;
}
