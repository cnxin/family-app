// 假的 Home Assistant：黑盒与 e2e 用（隔离库里不可能有真的 HA）。
// E1 实现 /api/、/api/config、/api/states；E2 再补 /api/services/* 和 WebSocket 的最小子集。
//
//   const ha = await startFakeHomeAssistant({ token, states });
//   ha.url            // http://127.0.0.1:<port>
//   ha.mode = 'hang'  // 'ok' 正常；'hang' 收到请求不回（验超时）
//   ha.states = [...] // 换一批状态
//   await ha.stop()   // 关掉端口（验「连不上」）；ha.start() 在同一端口重新起来
//
// 也能单独跑：node scripts/fake-ha.mjs [port] [token]，带一批「石头扫地机 / 米家窗帘 / 海尔洗烘 / 净水器」样例。
import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';

export const SAMPLE_STATES = [
  {
    entity_id: 'vacuum.roborock_s8',
    state: 'docked',
    attributes: { friendly_name: 'Roborock S8', battery_level: 100 },
    last_changed: '2026-09-28T01:00:00+00:00',
  },
  {
    entity_id: 'cover.living_room_curtain',
    state: 'open',
    attributes: { friendly_name: '客厅窗帘', current_position: 80, device_class: 'curtain' },
    last_changed: '2026-09-28T00:30:00+00:00',
  },
  {
    entity_id: 'sensor.washer_remaining_time',
    state: '38',
    attributes: { friendly_name: '洗衣机 剩余时间', unit_of_measurement: 'min', device_class: 'duration' },
    last_changed: '2026-09-28T02:00:00+00:00',
  },
  {
    entity_id: 'binary_sensor.dryer_running',
    state: 'off',
    attributes: { friendly_name: '烘干机 运行中', device_class: 'running' },
    last_changed: '2026-09-28T02:10:00+00:00',
  },
  {
    entity_id: 'sensor.water_purifier_filter_life',
    state: '12',
    attributes: { friendly_name: '净水器 滤芯寿命', unit_of_measurement: '%' },
    last_changed: '2026-09-27T12:00:00+00:00',
  },
  // 门锁、安防和不支持的 domain：目录里不该出现
  { entity_id: 'lock.front_door', state: 'locked', attributes: { friendly_name: '大门' } },
  { entity_id: 'alarm_control_panel.home', state: 'disarmed', attributes: { friendly_name: '安防' } },
  { entity_id: 'person.dad', state: 'home', attributes: { friendly_name: '爸爸', latitude: 31.2 } },
  { entity_id: 'sun.sun', state: 'above_horizon', attributes: { friendly_name: 'Sun' } },
];

export async function startFakeHomeAssistant({ token, states = SAMPLE_STATES, version = '2026.9.4', port = 0 } = {}) {
  const ha = {
    url: '',
    mode: 'ok',
    states,
    requests: [],
    start,
    stop,
  };
  let server = null;
  let boundPort = port;

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

  async function start() {
    server = createServer(handle);
    await new Promise((resolve) => server.listen(boundPort, '127.0.0.1', resolve));
    boundPort = server.address().port;
    ha.url = `http://127.0.0.1:${boundPort}`;
    return ha;
  }

  async function stop() {
    if (!server) return;
    const closing = server;
    server = null;
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
