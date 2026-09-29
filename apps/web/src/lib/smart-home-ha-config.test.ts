import { describe, expect, it } from 'vitest';
import { DEFAULT_SMART_HOME_RULES, type SmartHomeRules } from '@family/contracts';
import { homeAssistantAutomations, homeAssistantRestCommand } from './smart-home-ha-config';

// 生成的 YAML 已在一次性的 HA 2026.9.4 容器里真跑过：模板实体翻转触发自动化，签名与服务端算法逐字节一致。
// 这里钉住结构，免得以后改坏。

const rules = (patch: Partial<SmartHomeRules> = {}): SmartHomeRules => ({ ...DEFAULT_SMART_HOME_RULES, ...patch });

describe('homeAssistantRestCommand', () => {
  const yaml = homeAssistantRestCommand({
    origin: 'http://192.168.50.148:8088/',
    path: '/smart-home/webhook/00000000-0000-4000-8000-000000000001',
    secret: 'abc_DEF-123',
  });

  it('地址拼上 /api 与 webhook 路径', () => {
    expect(yaml).toContain('url: "http://192.168.50.148:8088/api/smart-home/webhook/00000000-0000-4000-8000-000000000001"');
  });

  it('签名和请求体引用同一个 body | to_json，外面再用密钥包一层', () => {
    expect(yaml).toContain(
      `X-Family-Signature: "{{ sha256('abc_DEF-123' ~ sha256('abc_DEF-123' ~ ts ~ '.' ~ (body | to_json))) }}"`,
    );
    expect(yaml).toContain('payload: "{{ body | to_json }}"');
    expect(yaml).toContain('X-Family-Timestamp: "{{ ts }}"');
  });
});

describe('homeAssistantAutomations', () => {
  it('没选触发实体就不生成', () => {
    expect(homeAssistantAutomations({ rules: rules(), entities: [] })).toBe('');
  });

  it('二元传感器：运行中 → 停止；数值：降到 1 以下；填了完成值：变成那个值', () => {
    const binary = homeAssistantAutomations({
      rules: rules({ laundry: { enabled: true, washer: null, dryer: { deviceId: '00000000-0000-4000-8000-000000000001', entityId: 'binary_sensor.dryer' }, doneValue: null } }),
      entities: [],
    });
    expect(binary).toContain('entity_id: binary_sensor.dryer\n      from: "on"\n      to: "off"');
    expect(binary).toContain('appliance: dryer');

    const numeric = homeAssistantAutomations({
      rules: rules({ laundry: { enabled: true, washer: { deviceId: '00000000-0000-4000-8000-000000000001', entityId: 'sensor.washer_left' }, dryer: null, doneValue: null } }),
      entities: [{ entityId: 'sensor.washer_left', numeric: true }],
    });
    expect(numeric).toContain('trigger: numeric_state\n      entity_id: sensor.washer_left\n      below: 1');

    const text = homeAssistantAutomations({
      rules: rules({ laundry: { enabled: true, washer: { deviceId: '00000000-0000-4000-8000-000000000001', entityId: 'sensor.washer_state' }, dryer: null, doneValue: '完成' } }),
      entities: [],
    });
    expect(text).toContain('entity_id: sensor.washer_state\n      to: "完成"');
  });

  it('扫地机：清扫中 / 回充中 → 在充电座上；滤芯：低于阈值带上当前值', () => {
    const yaml = homeAssistantAutomations({
      rules: rules({
        vacuum: { enabled: true, trigger: { deviceId: '00000000-0000-4000-8000-000000000001', entityId: 'vacuum.g30' } },
        filter: { enabled: true, trigger: { deviceId: '00000000-0000-4000-8000-000000000001', entityId: 'sensor.ro_life' }, threshold: 15 },
      }),
      entities: [],
    });
    expect(yaml).toContain('from: ["cleaning", "returning"]\n      to: "docked"');
    expect(yaml).toContain('entity_id: sensor.ro_life\n      below: 15');
    expect(yaml).toContain('event: filter_low');
    expect(yaml).toContain('value: "{{ (trigger.to_state.state | float(0))');
  });

  it('关着的联动不生成；事件 id 用触发的 context id', () => {
    const yaml = homeAssistantAutomations({
      rules: rules({ vacuum: { enabled: false, trigger: { deviceId: '00000000-0000-4000-8000-000000000001', entityId: 'vacuum.g30' } }, filter: { enabled: true, trigger: { deviceId: '00000000-0000-4000-8000-000000000001', entityId: 'sensor.ro' }, threshold: 10 } }),
      entities: [],
    });
    expect(yaml).not.toContain('vacuum_done');
    expect(yaml).toContain('eventId: "{{ trigger.to_state.context.id');
    expect(yaml).toContain('action: rest_command.family_app_event');
  });
});
