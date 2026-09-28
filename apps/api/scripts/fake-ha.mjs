// 假的 Home Assistant：黑盒与 e2e 用（隔离库里不可能有真的 HA）。
// REST：/api/、/api/config、/api/states。WebSocket（/api/websocket，不引依赖、手写最小帧）：
// auth → config/device_registry/list、config/entity_registry/list、config/area_registry/list。
// E2 再补 /api/services/*、call_service 和 subscribe_events。
//
//   const ha = await startFakeHomeAssistant({ token });
//   ha.url              // http://127.0.0.1:<port>
//   ha.mode = 'hang'    // 'ok' 正常；'hang' 收到请求不回（验超时）
//   ha.websocket = false // 拒绝 WebSocket（验目录退回平铺）
//   ha.states = [...]   // 换一批状态
//   await ha.stop()     // 关掉端口（验「连不上」）；ha.start() 在同一端口重新起来
//
// 也能单独跑：node scripts/fake-ha.mjs [port] [token]
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';

export const SAMPLE_AREAS = [
  { area_id: 'living_room', name: '客厅' },
  { area_id: 'kitchen', name: '厨房' },
];

// 3 台设备 × 5 个实体：每台都有诊断 / 配置类子实体，模拟米家、海尔集成那种「一台设备十几个实体」
export const SAMPLE_DEVICES = [
  { id: 'dev_roborock', name: 'Roborock S8', name_by_user: null, area_id: 'living_room', manufacturer: 'Roborock', model: 'S8' },
  { id: 'dev_curtain', name: 'Curtain Motor', name_by_user: '客厅窗帘', area_id: 'living_room', manufacturer: 'Xiaomi', model: 'curtain.v1' },
  { id: 'dev_purifier', name: '厨下净水', name_by_user: null, area_id: 'kitchen', manufacturer: 'Haier', model: 'HRO' },
];

const at = '2026-09-28T01:00:00+00:00';
function entity(entity_id, device_id, entity_category, friendly_name, state, attributes = {}) {
  return { registry: { entity_id, device_id, area_id: null, entity_category, disabled_by: null, hidden_by: null }, state: { entity_id, state, attributes: { friendly_name, ...attributes }, last_changed: at } };
}

const SAMPLE = [
  entity('vacuum.roborock_s8', 'dev_roborock', null, 'Roborock S8', 'docked', { battery_level: 100 }),
  entity('sensor.roborock_s8_cleaning_area', 'dev_roborock', null, 'Roborock S8 清扫面积', '32', { unit_of_measurement: 'm²' }),
  entity('sensor.roborock_s8_main_brush_left', 'dev_roborock', 'diagnostic', 'Roborock S8 主刷剩余', '120', { unit_of_measurement: 'h' }),
  entity('sensor.roborock_s8_filter_left', 'dev_roborock', 'diagnostic', 'Roborock S8 滤网剩余', '80', { unit_of_measurement: 'h' }),
  entity('select.roborock_s8_mop_intensity', 'dev_roborock', 'config', 'Roborock S8 拖地强度', '中'),

  entity('cover.living_room_curtain', 'dev_curtain', null, '客厅窗帘', 'open', { current_position: 80, device_class: 'curtain' }),
  entity('binary_sensor.living_room_curtain_fault', 'dev_curtain', 'diagnostic', '客厅窗帘 电机故障', 'off', { device_class: 'problem' }),
  entity('sensor.living_room_curtain_signal', 'dev_curtain', 'diagnostic', '客厅窗帘 信号强度', '-52', { unit_of_measurement: 'dBm' }),
  entity('number.living_room_curtain_speed', 'dev_curtain', 'config', '客厅窗帘 速度', '50'),
  entity('switch.living_room_curtain_child_lock', 'dev_curtain', 'config', '客厅窗帘 童锁', 'off'),

  entity('sensor.kitchen_purifier_ro_filter_life', 'dev_purifier', null, '厨下净水 RO滤芯寿命', '12', { unit_of_measurement: '%' }),
  entity('binary_sensor.kitchen_purifier_ro_expiring', 'dev_purifier', null, '厨下净水 RO到期预警', 'on', { device_class: 'problem' }),
  entity('sensor.kitchen_purifier_tds', 'dev_purifier', null, '厨下净水 出水TDS', '8', { unit_of_measurement: 'ppm' }),
  entity('sensor.kitchen_purifier_wifi', 'dev_purifier', 'diagnostic', '厨下净水 WiFi信号', '-60', { unit_of_measurement: 'dBm' }),
  entity('sensor.kitchen_purifier_firmware', 'dev_purifier', 'diagnostic', '厨下净水 固件版本', '1.2.3'),

  // 没有归属设备的场景；门锁、安防、人员位置和不支持的 domain：目录里不该出现
  entity('scene.movie_night', null, null, '电影之夜', 'scening'),
  entity('lock.front_door', null, null, '大门', 'locked'),
  entity('alarm_control_panel.home', null, null, '安防', 'disarmed'),
  entity('person.dad', null, null, '爸爸', 'home', { latitude: 31.2 }),
  entity('sun.sun', null, null, 'Sun', 'above_horizon'),
];

export const SAMPLE_STATES = SAMPLE.map((one) => one.state);
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
    start,
    stop,
  };
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
    return send(404, { message: 'Not found' });
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
    socket.on('close', () => sockets.delete(socket));
    socket.on('error', () => sockets.delete(socket));
    const send = (message) => socket.write(frame(JSON.stringify(message)));
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
