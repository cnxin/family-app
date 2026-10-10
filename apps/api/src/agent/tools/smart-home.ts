import { z } from 'zod';
import { defineTool, MAX_RESULT_ITEMS, type AgentToolDeps } from './context';

const CONNECTION_TEXT = {
  connected: '已连接',
  unreachable: '连不上 Home Assistant，下面是最近一次读到的状态',
  not_configured: '家里还没连 Home Assistant',
} as const;

/** J4 第四批：智能家居设备的一句状态（与控制页卡片同一套说法）。只读，不控制设备。 */
export const getDeviceStatusTool = (deps: AgentToolDeps) =>
  defineTool({
    name: 'get_device_status',
    description: '读取智能家居设备的当前状态，每台设备一句话（如「正在清扫 · 80%」「制冷 26°」「滤芯剩 8%」「离线」）；可用 deviceId 看一台，或用 room 按房间名筛。只读，不能控制设备。回答家里设备开没开、在不在运行前调用本工具。',
    kind: 'read',
    schema: z.object({
      deviceId: z.string().uuid().optional(),
      room: z.string().min(1).max(40).optional(),
    }),
    async execute({ user }, input) {
      const result = await deps.facades.get('smart-home').deviceStatuses(
        {
          ...(typeof input.deviceId === 'string' ? { deviceId: input.deviceId } : {}),
          ...(typeof input.room === 'string' ? { room: input.room } : {}),
        },
        user,
      );
      return {
        connection: CONNECTION_TEXT[result.connection],
        devices: result.devices.slice(0, MAX_RESULT_ITEMS).map((device) => ({
          id: device.id,
          name: device.name,
          room: device.room,
          status: device.status,
          online: device.online,
        })),
        targetPath: '/house/smart-home',
      };
    },
  });
