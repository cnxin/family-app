import { MediaRequestStatus } from '../src/entities';
import { reconciledMoviePilotState } from '../src/media/moviepilot-reconciliation.service';
import { MediaAutomationRequest } from '../src/media/providers';

function assert(condition: unknown, message: string) {
  if (!condition) throw new Error(`断言失败: ${message}`);
}

function current(
  status: MediaRequestStatus,
  externalRequestId: string | null = null,
) {
  return { status, externalRequestId };
}

function external(
  status: MediaAutomationRequest['status'],
  requestId: string,
  message?: string,
): MediaAutomationRequest {
  return {
    requestId,
    status,
    externalRefs: [],
    updatedAt: new Date('2026-07-31T05:30:00.000Z'),
    message,
  };
}

const checkedAt = new Date('2026-07-31T05:31:00.000Z');
const missing = reconciledMoviePilotState(
  current('processing', '88'),
  null,
  checkedAt,
);
assert(
  missing?.status === 'failed' &&
    missing.externalRequestId === '88' &&
    missing.lastSyncedAt === checkedAt,
  '进行中的请求在 MoviePilot 完全消失后转为失败并保留可追踪编号',
);

assert(
  reconciledMoviePilotState(current('completed'), null, checkedAt) === null,
  '最近完成的请求在外部记录暂时不可见时不会被误判失败',
);

const downloading = reconciledMoviePilotState(
  current('pending', '88'),
  external('processing', 'media-download:movie:568160:0', '下载中 · 63%'),
);
assert(
  downloading?.status === 'processing' &&
    downloading.externalRequestId === null &&
    downloading.message === '下载中 · 63%',
  '下载阶段可以自动推进且临时阶段编号不写入数据库',
);

const recovered = reconciledMoviePilotState(
  current('failed'),
  external('completed', 'media-transfer:movie:568160:0', 'MoviePilot 已完成整理'),
);
assert(
  recovered?.status === 'completed' &&
    recovered.externalRequestId === null &&
    recovered.message === 'MoviePilot 已完成整理',
  '失败请求在重新整理成功后可以自动恢复为完成',
);

const accepted = reconciledMoviePilotState(
  current('pending'),
  external('pending', '12345'),
);
assert(
  accepted?.externalRequestId === '12345',
  'MoviePilot 的稳定订阅编号继续持久化以便后续查询',
);

const longRequestId = reconciledMoviePilotState(
  current('pending'),
  external('pending', '1'.repeat(240)),
);
assert(
  longRequestId?.externalRequestId?.length === 180,
  'MoviePilot 的稳定订阅编号受数据库长度约束',
);

const longMessage = reconciledMoviePilotState(
  current('processing'),
  external('failed', 'media-transfer:movie:1:0', 'x'.repeat(1200)),
);
assert(longMessage?.message?.length === 1000, '外部状态说明受数据库长度约束');

console.log('MoviePilot 后台对账契约测试通过：状态推进、完成复核与重整恢复');
