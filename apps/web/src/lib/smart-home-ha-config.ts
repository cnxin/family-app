import type { SmartHomeRules } from '@family/contracts';

/**
 * 生成贴进 Home Assistant 的配置（E3）。两段：
 * 1. configuration.yaml 里的 rest_command：发请求、在 HA 模板里算签名。
 *    签名 = sha256(密钥 + sha256(密钥 + 时间戳 + "." + 正文))，正文就是 `body | to_json`——
 *    请求体和签名引用的是同一个表达式，逐字节一致（服务端按原始请求体验）。
 *    HA 模板只有 sha256 这类普通哈希、没有 HMAC，所以不是 HMAC（见 contracts 里 E3 的说明）。
 * 2. 三条自动化：满足条件就调上面的 rest_command，事件 id 用触发这次变化的 context id（HA 重发时不变）。
 * 密钥会原样写进 YAML：HA 要拿它签名，这是没法避免的；轮换后要重新粘贴。
 */

export interface HaEntityHint {
  entityId: string;
  /** 当前状态是不是数字（剩余时间、滤芯百分比这类） */
  numeric: boolean;
}

export interface HaConfigInput {
  /** HA 能访问到的小管家地址，比如 http://192.168.50.148:8088 */
  origin: string;
  /** webhook-settings 返回的 path：/smart-home/webhook/<householdId> */
  path: string;
  secret: string;
  rules: SmartHomeRules;
  entities: HaEntityHint[];
}

const quote = (value: string) => `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

/** 触发这次变化的 context id；手动运行自动化时没有 trigger.to_state，退回一个时间戳。 */
const EVENT_ID = "\"{{ trigger.to_state.context.id if (trigger is defined and trigger.to_state is defined and trigger.to_state) else 'manual-' ~ (now().timestamp() | int) }}\"";

function laundryTrigger(entityId: string, doneValue: string | null, numeric: boolean) {
  if (doneValue) return [`    - trigger: state`, `      entity_id: ${entityId}`, `      to: ${quote(doneValue)}`];
  if (entityId.startsWith('binary_sensor.')) {
    return [`    - trigger: state`, `      entity_id: ${entityId}`, `      from: "on"`, `      to: "off"`];
  }
  if (numeric) return [`    - trigger: numeric_state`, `      entity_id: ${entityId}`, `      below: 1`];
  // 文字状态又没填「完成时的值」：给出能改的样子，粘贴前要填
  return [`    - trigger: state`, `      entity_id: ${entityId}`, `      to: "完成"  # 改成它完成时显示的状态`];
}

function automation(id: string, alias: string, trigger: string[], body: string[]) {
  return [
    `- id: ${id}`,
    `  alias: ${quote(alias)}`,
    `  mode: queued`,
    `  triggers:`,
    ...trigger,
    `  actions:`,
    `    - action: rest_command.family_app_event`,
    `      data:`,
    `        ts: "{{ now().timestamp() | int }}"`,
    `        body:`,
    `          eventId: ${EVENT_ID}`,
    ...body.map((line) => `          ${line}`),
  ].join('\n');
}

export function homeAssistantRestCommand({ origin, path, secret }: Pick<HaConfigInput, 'origin' | 'path' | 'secret'>) {
  const url = `${origin.replace(/\/$/, '')}/api${path}`;
  const key = `'${secret}'`;
  return [
    'rest_command:',
    '  family_app_event:',
    `    url: ${quote(url)}`,
    '    method: POST',
    '    content_type: "application/json"',
    '    timeout: 10',
    '    headers:',
    '      X-Family-Timestamp: "{{ ts }}"',
    `      X-Family-Signature: "{{ sha256(${key} ~ sha256(${key} ~ ts ~ '.' ~ (body | to_json))) }}"`,
    '    payload: "{{ body | to_json }}"',
  ].join('\n');
}

export function homeAssistantAutomations({ rules, entities }: Pick<HaConfigInput, 'rules' | 'entities'>) {
  const numeric = (entityId: string) => entities.find((entity) => entity.entityId === entityId)?.numeric ?? false;
  const blocks: string[] = [];
  const { laundry, vacuum, filter } = rules;
  if (laundry.enabled) {
    for (const [appliance, entityId, label] of [
      ['washer', laundry.washer?.entityId ?? null, '洗衣机'],
      ['dryer', laundry.dryer?.entityId ?? null, '烘干机'],
    ] as const) {
      if (!entityId) continue;
      blocks.push(
        automation(
          `family_app_${appliance}_done`,
          `小管家 · ${label}完成`,
          laundryTrigger(entityId, laundry.doneValue, numeric(entityId)),
          ['event: laundry_done', `appliance: ${appliance}`, 'entityId: "{{ trigger.entity_id | default(\'\') }}"'],
        ),
      );
    }
  }
  if (vacuum.enabled && vacuum.trigger) {
    blocks.push(
      automation(
        'family_app_vacuum_done',
        '小管家 · 扫地完成',
        [`    - trigger: state`, `      entity_id: ${vacuum.trigger.entityId}`, `      from: ["cleaning", "returning"]`, `      to: "docked"`],
        ['event: vacuum_done', 'entityId: "{{ trigger.entity_id | default(\'\') }}"'],
      ),
    );
  }
  if (filter.enabled && filter.trigger) {
    blocks.push(
      automation(
        'family_app_filter_low',
        '小管家 · 净水器滤芯低',
        [`    - trigger: numeric_state`, `      entity_id: ${filter.trigger.entityId}`, `      below: ${filter.threshold}`],
        [
          'event: filter_low',
          'entityId: "{{ trigger.entity_id | default(\'\') }}"',
          'value: "{{ (trigger.to_state.state | float(0)) if (trigger is defined and trigger.to_state is defined and trigger.to_state) else 0 }}"',
        ],
      ),
    );
  }
  return blocks.join('\n\n');
}
