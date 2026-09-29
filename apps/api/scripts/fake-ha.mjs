// 假的 Home Assistant：黑盒与 e2e 用（隔离库里不可能有真的 HA）。
// REST：/api/、/api/config、/api/states。WebSocket（/api/websocket，不引依赖、手写最小帧）：
// auth → config/device_registry/list、config/entity_registry/list、config/area_registry/list。
// E2：POST /api/services/<domain>/<service>（按动作改状态并推事件）、WebSocket subscribe_events / ping。
// R1b：WebSocket frontend/get_translations（中文翻译）、GET /api/history/period/<时间>（24 小时趋势）；
// 服务里加上详情面板用到的 select / number / button / 吸力 / 按区域清扫 / 风速 / 摆风 / 窗帘位置。
//   ha.history = { [entityId]: [{ state, last_changed }] } // 换一段历史（默认按当前值造 3 个点）
//
//   const ha = await startFakeHomeAssistant({ token });
//   ha.url              // http://127.0.0.1:<port>
//   ha.mode = 'hang'    // 'ok' 正常；'hang' 收到请求不回（验超时）
//   ha.websocket = false // 拒绝 WebSocket（验目录退回平铺）
//   ha.states = [...]   // 换一批状态
//   ha.setState(id, state, attrs) // 改一个实体并向订阅者推 state_changed（模拟有人在 HA / App 里操作）
//   ha.serviceMode = 'fail' | 'hang' // 服务调用失败（500）/ 不回
//   ha.serviceCalls     // 收到的服务调用 [{ domain, service, data }]
//   ha.dropWebSockets() / ha.subscriberCount()
//   await ha.stop()     // 关掉端口（验「连不上」）；ha.start() 在同一端口重新起来
//
// 也能单独跑：node scripts/fake-ha.mjs [port] [token]
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';

export const SAMPLE_AREAS = [
  { area_id: 'living_room', name: '客厅' },
  { area_id: 'kitchen', name: '厨房' },
  { area_id: 'bedroom', name: '卧室' },
];

// 3 台设备 × 5 个实体：每台都有诊断 / 配置类子实体，模拟米家、海尔集成那种「一台设备十几个实体」
export const SAMPLE_DEVICES = [
  { id: 'dev_roborock', name: 'Roborock S8', name_by_user: null, area_id: 'living_room', manufacturer: 'Roborock', model: 'S8' },
  { id: 'dev_curtain', name: 'Curtain Motor', name_by_user: '客厅窗帘', area_id: 'living_room', manufacturer: 'Xiaomi', model: 'curtain.v1' },
  { id: 'dev_purifier', name: '厨下净水', name_by_user: null, area_id: 'kitchen', manufacturer: 'Haier', model: 'HRO' },
  // 米家智能插座：集成不标 entity_category，一台十来个实体（验「每台最多展开 4 个」和「* 」前缀）
  { id: 'dev_box', name: '防潮箱', name_by_user: null, area_id: 'bedroom', manufacturer: '小白', model: 'plug' },
  // 米家空调伴侣（红外）：HA 只记得上次发了什么
  { id: 'dev_ac', name: '空调伴侣', name_by_user: '空调插座', area_id: 'bedroom', manufacturer: 'Aqara', model: 'acpartner' },
  // HA 自己的服务型「设备」：目录里不该出现
  { id: 'dev_backup', name: 'Backup', name_by_user: null, area_id: null, manufacturer: 'Home Assistant', model: null, entry_type: 'service' },
  { id: 'dev_sun', name: 'Sun', name_by_user: null, area_id: null, manufacturer: null, model: null, entry_type: 'service' },
];

const at = '2026-09-28T01:00:00+00:00';
function entity(entity_id, device_id, entity_category, friendly_name, state, attributes = {}, registry = {}) {
  return { registry: { entity_id, device_id, area_id: null, entity_category, disabled_by: null, hidden_by: null, ...registry }, state: { entity_id, state, attributes: { friendly_name, ...attributes }, last_changed: at } };
}

const SAMPLE = [
  // supported_features 30524 = 真机 G30 U 的值（含 START / PAUSE / RETURN_HOME / FAN_SPEED / CLEAN_AREA）；
  // 分区 ↔ 区域的对应在实体注册表的 options.vacuum.area_mapping（HA 2026.3 起）
  entity(
    'vacuum.roborock_s8',
    'dev_roborock',
    null,
    'Roborock S8',
    'docked',
    { battery_level: 100, supported_features: 30524, fan_speed: 'balanced', fan_speed_list: ['quiet', 'balanced', 'turbo', 'max'] },
    {
      platform: 'roborock',
      translation_key: 'roborock',
      options: { vacuum: { area_mapping: { living_room: ['16'], kitchen: ['17', '18'], bedroom: [] } } },
    },
  ),
  entity('sensor.roborock_s8_cleaning_area', 'dev_roborock', null, 'Roborock S8 清扫面积', '32', { unit_of_measurement: 'm²' }),
  entity('sensor.roborock_s8_main_brush_left', 'dev_roborock', 'diagnostic', 'Roborock S8 主刷剩余', '120', { unit_of_measurement: 'h' }),
  entity('sensor.roborock_s8_filter_left', 'dev_roborock', 'diagnostic', 'Roborock S8 滤网剩余', '80', { unit_of_measurement: 'h' }),
  entity(
    'select.roborock_s8_mop_intensity',
    'dev_roborock',
    'config',
    'Roborock S8 拖地强度',
    'medium',
    { options: ['off', 'low', 'medium', 'high'] },
    { platform: 'roborock', translation_key: 'mop_intensity' },
  ),
  entity('number.roborock_s8_volume', 'dev_roborock', 'config', 'Roborock S8 音量', '60', {
    min: 0, max: 100, step: 1, mode: 'auto', unit_of_measurement: '%',
  }),
  // 石头 App 里建的例程：没有类别的按钮；「重置耗材」没有 device_class、名字带「重置」；「重启」按 device_class 排除
  entity('button.roborock_s8_routine', 'dev_roborock', null, 'Roborock S8 饭后打扫', 'unknown'),
  entity('button.roborock_s8_reset_filter', 'dev_roborock', 'config', 'Roborock S8 重置滤网耗材', 'unknown'),
  entity('button.roborock_s8_reboot', 'dev_roborock', 'config', 'Roborock S8 设备', 'unknown', { device_class: 'restart' }),

  entity('cover.living_room_curtain', 'dev_curtain', null, '客厅窗帘', 'open', {
    current_position: 80, device_class: 'curtain', supported_features: 15,
  }),
  entity('binary_sensor.living_room_curtain_fault', 'dev_curtain', 'diagnostic', '客厅窗帘 电机故障', 'off', { device_class: 'problem' }),
  entity('sensor.living_room_curtain_signal', 'dev_curtain', 'diagnostic', '客厅窗帘 信号强度', '-52', { unit_of_measurement: 'dBm' }),
  entity('number.living_room_curtain_speed', 'dev_curtain', 'config', '客厅窗帘 速度', '50'),
  entity('switch.living_room_curtain_child_lock', 'dev_curtain', 'config', '客厅窗帘 童锁', 'off'),

  entity('sensor.kitchen_purifier_ro_filter_life', 'dev_purifier', null, '厨下净水 RO滤芯寿命', '12', { unit_of_measurement: '%' }),
  entity('binary_sensor.kitchen_purifier_ro_expiring', 'dev_purifier', null, '厨下净水 RO到期预警', 'on', { device_class: 'problem' }),
  entity('sensor.kitchen_purifier_tds', 'dev_purifier', null, '厨下净水 出水TDS', '8', { unit_of_measurement: 'ppm' }),
  entity('sensor.kitchen_purifier_wifi', 'dev_purifier', 'diagnostic', '厨下净水 WiFi信号', '-60', { unit_of_measurement: 'dBm' }),
  entity('sensor.kitchen_purifier_firmware', 'dev_purifier', 'diagnostic', '厨下净水 固件版本', '1.2.3'),

  entity('switch.dehumidify_box', 'dev_box', null, '防潮箱 开关 开关', 'on'),
  entity('switch.dehumidify_box_loop', 'dev_box', null, '防潮箱 * 循环任务、按键倒计时 循环任务的开关', 'off'),
  entity('sensor.dehumidify_box_power', 'dev_box', null, '防潮箱 功耗参数 电功率', '35', { unit_of_measurement: 'W', device_class: 'power' }),
  entity('sensor.dehumidify_box_current', 'dev_box', null, '防潮箱 功耗参数 电流', '0.2', { unit_of_measurement: 'A', device_class: 'current' }),
  entity('sensor.dehumidify_box_voltage', 'dev_box', null, '防潮箱 功耗参数 电压', '220', { unit_of_measurement: 'V', device_class: 'voltage' }),
  entity('sensor.dehumidify_box_energy', 'dev_box', null, '防潮箱 功耗参数 耗电量', '1.2', { unit_of_measurement: 'kWh', device_class: 'energy' }),
  entity('sensor.dehumidify_box_temperature', 'dev_box', null, '防潮箱 开关 温度', '31', { unit_of_measurement: '°C', device_class: 'temperature' }),
  entity('light.dehumidify_box_indicator', 'dev_box', 'config', '防潮箱 指示灯', 'on'),
  entity('sensor.dehumidify_box_hidden', 'dev_box', null, '防潮箱 被隐藏的', '1', {}, { hidden_by: 'user' }),
  entity('sensor.dehumidify_box_disabled', 'dev_box', null, '防潮箱 被停用的', '1', {}, { disabled_by: 'user' }),
  entity('climate.bedroom_ac', 'dev_ac', null, '空调插座', 'off', {
    hvac_modes: ['off', 'cool', 'heat', 'fan_only', 'auto'],
    temperature: 26,
    current_temperature: 28,
    min_temp: 16,
    max_temp: 30,
    assumed_state: true,
    // 真机空调伴侣：步长 1、风速是中文、有上下摆风；supported_features 425 同真机
    target_temp_step: 1,
    fan_modes: ['自动', '低', '中', '高'],
    fan_mode: '自动',
    swing_modes: ['off', 'vertical'],
    swing_mode: 'off',
    current_humidity: 58,
    supported_features: 425,
  }),
  entity('sensor.backup_manager_state', 'dev_backup', null, '备份管理器状态', 'idle'),
  entity('sensor.sun_next_dawn', 'dev_sun', 'diagnostic', '下个清晨', '2026-09-29T21:30:00+00:00', { device_class: 'timestamp' }),

  // 没有归属设备的场景；门锁、安防、人员位置和不支持的 domain：目录里不该出现
  entity('scene.movie_night', null, null, '电影之夜', 'scening'),
  entity('lock.front_door', null, null, '大门', 'locked'),
  entity('alarm_control_panel.home', null, null, '安防', 'disarmed'),
  entity('person.dad', null, null, '爸爸', 'home', { latitude: 31.2 }),
  entity('sun.sun', null, null, 'Sun', 'above_horizon'),
];

export const SAMPLE_STATES = SAMPLE.map((one) => one.state);
/** HA 前端翻译（frontend/get_translations，zh-Hans）里这几个集成的键 */
export const SAMPLE_TRANSLATIONS = {
  'component.roborock.entity.select.mop_intensity.state.off': '关闭',
  'component.roborock.entity.select.mop_intensity.state.low': '低',
  'component.roborock.entity.select.mop_intensity.state.medium': '中',
  'component.roborock.entity.select.mop_intensity.state.high': '高',
  'component.roborock.entity.vacuum.roborock.state_attributes.fan_speed.state.quiet': '安静',
  'component.roborock.entity.vacuum.roborock.state_attributes.fan_speed.state.balanced': '均衡',
  'component.roborock.entity.vacuum.roborock.state_attributes.fan_speed.state.turbo': '强力',
  'component.roborock.entity.vacuum.roborock.state_attributes.fan_speed.state.max': '最大',
};
export const SAMPLE_ENTITY_REGISTRY = SAMPLE.map((one) => one.registry);

const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

function frame(text) {
  const payload = Buffer.from(text, 'utf8');
  const length = payload.length;
  const header =
    length < 126
      ? Buffer.from([0x81, length])
      : length < 65536
        ? Buffer.from([0x81, 126, length >> 8, length & 0xff])
        : Buffer.concat([Buffer.from([0x81, 127]), (() => { const b = Buffer.alloc(8); b.writeBigUInt64BE(BigInt(length)); return b; })()]);
  return Buffer.concat([header, payload]);
}

/** 从缓冲区里切出完整的客户端帧（客户端帧一定带掩码）。返回 [帧列表, 剩下的字节]。 */
function readFrames(buffer) {
  const frames = [];
  let offset = 0;
  while (buffer.length - offset >= 2) {
    const opcode = buffer[offset] & 0x0f;
    const masked = (buffer[offset + 1] & 0x80) !== 0;
    let length = buffer[offset + 1] & 0x7f;
    let cursor = offset + 2;
    if (length === 126) {
      if (buffer.length < cursor + 2) break;
      length = buffer.readUInt16BE(cursor);
      cursor += 2;
    } else if (length === 127) {
      if (buffer.length < cursor + 8) break;
      length = Number(buffer.readBigUInt64BE(cursor));
      cursor += 8;
    }
    const maskLength = masked ? 4 : 0;
    if (buffer.length < cursor + maskLength + length) break;
    const mask = masked ? buffer.subarray(cursor, cursor + 4) : null;
    cursor += maskLength;
    const payload = Buffer.from(buffer.subarray(cursor, cursor + length));
    if (mask) for (let index = 0; index < payload.length; index += 1) payload[index] ^= mask[index % 4];
    frames.push({ opcode, payload });
    offset = cursor + length;
  }
  return [frames, buffer.subarray(offset)];
}

export async function startFakeHomeAssistant({
  token,
  states = SAMPLE_STATES,
  devices = SAMPLE_DEVICES,
  entityRegistry = SAMPLE_ENTITY_REGISTRY,
  areas = SAMPLE_AREAS,
  version = '2026.9.4',
  port = 0,
} = {}) {
  const ha = {
    url: '',
    mode: 'ok',
    websocket: true,
    states,
    devices,
    entityRegistry,
    areas,
    requests: [],
    serviceMode: 'ok',
    serviceCalls: [],
    translations: SAMPLE_TRANSLATIONS,
    history: {},
    setState,
    /** 掐断现有的 WebSocket（模拟网络抖动 / HA 重启），HTTP 照常 */
    dropWebSockets() {
      for (const socket of sockets) socket.destroy();
      sockets.clear();
      clients.clear();
    },
    subscriberCount: () => clients.size,
    start,
    stop,
  };
  const clients = new Set();
  let server = null;
  let boundPort = port;
  const sockets = new Set();

  function handle(request, response) {
    ha.requests.push({ method: request.method, path: request.url, authorization: request.headers.authorization ?? null });
    if (ha.mode === 'hang') return; // 不回，等客户端自己超时
    const send = (status, body) => {
      response.writeHead(status, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify(body));
    };
    if (request.headers.authorization !== `Bearer ${token}`) return send(401, { message: '401: Unauthorized' });
    if (request.method === 'GET' && request.url === '/api/') return send(200, { message: 'API running.' });
    if (request.method === 'GET' && request.url === '/api/config') {
      return send(200, { version, location_name: '测试的家', time_zone: 'Asia/Shanghai' });
    }
    if (request.method === 'GET' && request.url === '/api/states') return send(200, ha.states);
    if (request.method === 'GET' && request.url?.startsWith('/api/history/period/')) {
      const url = new URL(request.url, 'http://fake');
      const entityId = url.searchParams.get('filter_entity_id');
      const current = ha.states.find((entry) => entry.entity_id === entityId);
      if (!current) return send(200, []);
      const now = Date.now();
      const series =
        ha.history[entityId] ??
        [3, 2, 1].map((hoursAgo, index) => ({
          state: String(Number(current.state) - index),
          last_changed: new Date(now - hoursAgo * 3_600_000).toISOString(),
        }));
      return send(200, [series.map((point) => ({ entity_id: entityId, ...point }))]);
    }
    const service = /^\/api\/services\/([a-z_]+)\/([a-z_]+)$/.exec(request.url ?? '');
    if (request.method === 'POST' && service) {
      let raw = '';
      request.on('data', (chunk) => (raw += chunk));
      request.on('end', () => {
        const data = raw ? JSON.parse(raw) : {};
        ha.serviceCalls.push({ domain: service[1], service: service[2], data });
        if (ha.serviceMode === 'hang') return;
        if (ha.serviceMode === 'fail') return send(500, { message: 'Service call failed' });
        const next = applyService(service[1], service[2], data.entity_id, data);
        send(200, next ? [next] : []);
      });
      return;
    }
    return send(404, { message: 'Not found' });
  }

  /** 服务调用对状态的影响，和真 HA 里这些实体的行为大致一致。 */
  function applyService(domain, service, entityId, data = {}) {
    const current = ha.states.find((entry) => entry.entity_id === entityId);
    if (!current) return null;
    const transitions = {
      'vacuum.start': ['cleaning'],
      'vacuum.pause': ['paused'],
      'vacuum.return_to_base': ['returning'],
      'vacuum.stop': ['idle'],
      'cover.open_cover': ['open', { current_position: 100 }],
      'cover.close_cover': ['closed', { current_position: 0 }],
      'cover.stop_cover': [current.state],
      'switch.turn_on': ['on'],
      'switch.turn_off': ['off'],
      'scene.turn_on': [new Date().toISOString()],
      'climate.turn_on': [current.attributes.last_mode ?? 'cool'],
      'climate.turn_off': ['off', { last_mode: current.state === 'off' ? current.attributes.last_mode : current.state }],
      'climate.set_hvac_mode': [data.hvac_mode ?? current.state],
      'climate.set_temperature': [current.state, { temperature: data.temperature }],
      'climate.set_fan_mode': [current.state, { fan_mode: data.fan_mode }],
      'climate.set_swing_mode': [current.state, { swing_mode: data.swing_mode }],
      'cover.set_cover_position': [
        data.position === 0 ? 'closed' : 'open',
        { current_position: data.position },
      ],
      'vacuum.set_fan_speed': [current.state, { fan_speed: data.fan_speed }],
      'vacuum.clean_area': ['cleaning'],
      'select.select_option': [data.option ?? current.state],
      'number.set_value': [String(data.value ?? current.state)],
      'button.press': [new Date().toISOString()],
      'light.turn_on': ['on'],
      'light.turn_off': ['off'],
    };
    const [state, attributes] = transitions[`${domain}.${service}`] ?? [current.state];
    return setState(entityId, state, attributes);
  }

  function setState(entityId, state, attributes = {}) {
    const index = ha.states.findIndex((entry) => entry.entity_id === entityId);
    if (index < 0) return null;
    const old = ha.states[index];
    const at = new Date().toISOString();
    const next = {
      ...old,
      state,
      attributes: { ...old.attributes, ...attributes },
      last_changed: state === old.state ? old.last_changed : at,
      last_updated: at,
    };
    ha.states = ha.states.map((entry, position) => (position === index ? next : entry));
    for (const client of clients) {
      for (const id of client.subscriptions) {
        client.send({ id, type: 'event', event: { event_type: 'state_changed', data: { entity_id: entityId, old_state: old, new_state: next } } });
      }
    }
    return next;
  }

  function upgrade(request, socket) {
    ha.requests.push({ method: 'WS', path: request.url, authorization: null });
    if (request.url !== '/api/websocket' || !ha.websocket) {
      socket.end('HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\n\r\n');
      return;
    }
    if (ha.mode === 'hang') {
      sockets.add(socket);
      return;
    }
    const accept = createHash('sha1').update(`${request.headers['sec-websocket-key']}${WS_GUID}`).digest('base64');
    socket.write(
      `HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`,
    );
    sockets.add(socket);
    const send = (message) => {
      if (!socket.destroyed) socket.write(frame(JSON.stringify(message)));
    };
    const client = { send, subscriptions: new Set() };
    socket.on('close', () => {
      sockets.delete(socket);
      clients.delete(client);
    });
    socket.on('error', () => {
      sockets.delete(socket);
      clients.delete(client);
    });
    let authed = false;
    let pending = Buffer.alloc(0);
    send({ type: 'auth_required', ha_version: version });
    socket.on('data', (chunk) => {
      const [frames, rest] = readFrames(Buffer.concat([pending, chunk]));
      pending = rest;
      for (const { opcode, payload } of frames) {
        if (opcode === 0x8) {
          socket.end(Buffer.from([0x88, 0]));
          return;
        }
        if (opcode === 0x9) {
          socket.write(Buffer.concat([Buffer.from([0x8a, payload.length]), payload]));
          continue;
        }
        if (opcode !== 0x1) continue;
        let message;
        try {
          message = JSON.parse(payload.toString('utf8'));
        } catch {
          continue;
        }
        if (!authed) {
          if (message.type === 'auth' && message.access_token === token) {
            authed = true;
            send({ type: 'auth_ok', ha_version: version });
          } else {
            send({ type: 'auth_invalid', message: 'Invalid access token or password' });
            socket.end();
          }
          continue;
        }
        const results = {
          'config/device_registry/list': ha.devices,
          'config/entity_registry/list': ha.entityRegistry,
          'config/area_registry/list': ha.areas,
        };
        if (message.type === 'ping') {
          send({ id: message.id, type: 'pong' });
          continue;
        }
        if (message.type === 'subscribe_events') {
          client.subscriptions.add(message.id);
          clients.add(client);
          send({ id: message.id, type: 'result', success: true, result: null });
          continue;
        }
        if (message.type === 'frontend/get_translations') {
          const wanted = Array.isArray(message.integration) ? message.integration : [];
          const resources = Object.fromEntries(
            Object.entries(ha.translations).filter(([key]) => wanted.some((one) => key.startsWith(`component.${one}.`))),
          );
          send({ id: message.id, type: 'result', success: true, result: { resources } });
          continue;
        }
        if (message.type in results) {
          send({ id: message.id, type: 'result', success: true, result: results[message.type] });
        } else {
          send({ id: message.id, type: 'result', success: false, error: { code: 'unknown_command', message: 'Unknown command.' } });
        }
      }
    });
  }

  async function start() {
    server = createServer(handle);
    server.on('upgrade', upgrade);
    await new Promise((resolve) => server.listen(boundPort, '127.0.0.1', resolve));
    boundPort = server.address().port;
    ha.url = `http://127.0.0.1:${boundPort}`;
    return ha;
  }

  async function stop() {
    if (!server) return;
    const closing = server;
    server = null;
    for (const socket of sockets) socket.destroy();
    sockets.clear();
    closing.closeAllConnections?.();
    await new Promise((resolve) => closing.close(resolve));
  }

  return start();
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const port = Number(process.argv[2] || 8124);
  const token = process.argv[3] || 'fake-home-assistant-long-lived-token';
  const ha = await startFakeHomeAssistant({ port, token });
  console.log(`假 Home Assistant：${ha.url}（令牌 ${token}）`);
}
