// 智能家居重做 R1b 黑盒：详情面板（smart-home-redesign §9）。面板结构与按角色裁剪、子实体归位（更多设置 / 设备信息 /
// 排除 / 待确认）、通用控件的每种动作放行与拒绝（值按 HA 属性校验）、排除名单、藏掉、新实体确认、
// 「允许控制」放宽到「有可控子实体」、分房间（HA 通用 clean_area + area_mapping）、翻译、24 小时趋势、最近操作、HA 断开。
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { startFakeHomeAssistant } from './fake-ha.mjs';

const BASE = process.env.API_URL || 'http://127.0.0.1:3100';
const PASSWORD = process.env.SEED_ACCOUNT_PASSWORD || 'family1234';
const TOKEN = `ha-long-lived-${randomUUID()}`;

function assert(condition, message) {
  if (!condition) throw new Error(`断言失败: ${message}`);
  console.log(`  ✓ ${message}`);
}

async function request(path, token, method = 'GET', body) {
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body == null ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null, text };
}

async function login(loginName) {
  const response = await request('/auth/login', null, 'POST', { loginName, password: PASSWORD });
  if (response.status !== 201) throw new Error(`${loginName} 登录失败 ${response.status}`);
  return response.body.data.accessToken;
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const db = new pg.Client({
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 5433),
  user: process.env.DB_USER || 'family',
  password: process.env.DB_PASSWORD || 'family123',
  database: process.env.DB_NAME || 'family_app',
});
await db.connect();
const ha = await startFakeHomeAssistant({ token: TOKEN });

try {
  const owner = await login('爸爸');
  const member = await login('妈妈');
  await request('/smart-home/connector-settings', owner, 'PUT', { baseUrl: ha.url, credential: TOKEN });
  const add = async (body) => (await request('/smart-home/devices', owner, 'POST', body)).body.data.id;
  const patch = (id, body) => request(`/smart-home/devices/${id}`, owner, 'PATCH', body);
  const panel = async (id, token = owner) => request(`/smart-home/devices/${id}/panel`, token);
  const command = (token, id, action, extra = {}) =>
    request(`/smart-home/devices/${id}/command`, token, 'POST', { action, requestId: randomUUID(), ...extra });
  const lastCall = () => ha.serviceCalls[ha.serviceCalls.length - 1];
  const vacuumId = await add({ haDeviceId: 'dev_roborock' });
  const acId = await add({ haDeviceId: 'dev_ac' });
  const curtainId = await add({ haDeviceId: 'dev_curtain' });
  const boxId = await add({ haDeviceId: 'dev_box' });
  const purifierId = await add({ haDeviceId: 'dev_purifier' });

  console.log('1. 面板结构（还没开放控制）');
  const closed = (await panel(vacuumId)).body.data;
  const ids = (list) => list.map((entity) => entity.entityId);
  assert(
    closed.primary.entityId === 'vacuum.roborock_s8' &&
      closed.primary.state.fanSpeed === 'balanced' &&
      closed.primary.control === null &&
      closed.canControl === false &&
      closed.more.length === 0 &&
      closed.manufacturer === 'Roborock' &&
      closed.model === 'S8',
    '没开放控制：主实体照常显示（带当前吸力），但没有控件、「更多设置」为空；头部带厂商型号',
  );
  assert(
    ids(closed.info).includes('sensor.roborock_s8_main_brush_left') &&
      ids(closed.info).includes('sensor.roborock_s8_filter_left') &&
      closed.info.every((entity) => entity.control === null),
    '诊断类传感器（主刷、滤网剩余）进「设备信息」，只读',
  );
  assert(
    JSON.stringify(ids(closed.excluded).sort()) === JSON.stringify(['button.roborock_s8_reboot', 'button.roborock_s8_reset_filter']) &&
      closed.excluded.find((one) => one.entityId === 'button.roborock_s8_reset_filter').name === '重置滤网耗材',
    '排除名单：名字带「重置」的按钮（没有 device_class）、device_class 为 restart 的按钮，不渲染成按钮',
  );
  assert(
    closed.recent.length === 0 && closed.pending.length === 0 && closed.catalog.some((one) => one.entityId === 'number.roborock_s8_volume'),
    '管理员拿到全部子实体目录（挑主面板项 / 藏掉用），还没有操作记录、没有待确认的新实体',
  );
  const memberClosed = (await panel(vacuumId, member)).body.data;
  assert(memberClosed.catalog.length === 0 && memberClosed.pending.length === 0, '成员拿不到子实体目录和待确认列表');

  console.log('2. 开放控制后：按类型渲染的控件');
  await patch(vacuumId, { controllable: true, minRole: 'member' });
  const open = (await panel(vacuumId, member)).body.data;
  const control = open.primary.control;
  assert(
    open.canControl === true &&
      control.kind === 'vacuum' &&
      JSON.stringify(control.actions) === JSON.stringify(['start', 'pause', 'return_to_base']) &&
      control.fanSpeeds.map((one) => one.label).join('/') === '安静/均衡/强力/最大',
    '扫地机主面板：三键；吸力来自 vacuum 本体的 fan_speed_list，中文用 HA 自己的翻译（「均衡」而不是内置的「标准」）',
  );
  assert(
    JSON.stringify(control.areas) === JSON.stringify([{ id: 'kitchen', name: '厨房' }, { id: 'living_room', name: '客厅' }]),
    '分房间：只列 HA 里对应过分区的区域（卧室对应了个空列表，不算），名字取 HA 区域',
  );
  const moreOf = Object.fromEntries(open.more.map((entity) => [entity.entityId, entity.control]));
  assert(
    moreOf['select.roborock_s8_mop_intensity'].kind === 'select' &&
      moreOf['select.roborock_s8_mop_intensity'].options.map((one) => one.label).join('/') === '关闭/低/中/高' &&
      moreOf['number.roborock_s8_volume'].kind === 'number' &&
      moreOf['number.roborock_s8_volume'].display === 'slider' &&
      moreOf['number.roborock_s8_volume'].unit === '%' &&
      moreOf['button.roborock_s8_routine'].kind === 'button' &&
      !('button.roborock_s8_reset_filter' in moreOf),
    '「更多设置」：config 类 select（选项中文来自 HA 翻译）、number（mode=auto、100 步以内 → 滑块）、例程按钮；排除的按钮不在里面',
  );

  console.log('3. 子实体控制：值按 HA 属性校验');
  const cases = [
    [member, vacuumId, 'set_fan_speed', { value: 'turbo' }, 201, 'vacuum.set_fan_speed', { fan_speed: 'turbo' }],
    [member, vacuumId, 'clean_area', { value: ['living_room', 'kitchen'] }, 201, 'vacuum.clean_area', { cleaning_area_id: ['living_room', 'kitchen'] }],
    [member, vacuumId, 'select_option', { entityId: 'select.roborock_s8_mop_intensity', value: 'high' }, 201, 'select.select_option', { option: 'high' }],
    [member, vacuumId, 'set_value', { entityId: 'number.roborock_s8_volume', value: 55 }, 201, 'number.set_value', { value: 55 }],
    [member, vacuumId, 'press', { entityId: 'button.roborock_s8_routine' }, 201, 'button.press', {}],
  ];
  for (const [token, id, action, extra, status, service, data] of cases) {
    const result = await command(token, id, action, extra);
    const call = lastCall();
    assert(
      result.status === status &&
        `${call.domain}.${call.service}` === service &&
        Object.entries(data).every(([key, value]) => JSON.stringify(call.data[key]) === JSON.stringify(value)),
      `${action}${extra.value !== undefined ? `(${JSON.stringify(extra.value)})` : ''} → HA ${service}`,
    );
  }
  const audit = await db.query(`SELECT service, "entityId" FROM smart_home_commands WHERE "deviceId" = $1 ORDER BY "createdAt"`, [vacuumId]);
  assert(
    audit.rows[0].service === 'vacuum.set_fan_speed(turbo)' && audit.rows[2].entityId === 'select.roborock_s8_mop_intensity',
    '审计记下子实体和值（「吸力 → 强力」这类）',
  );
  const before = ha.serviceCalls.length;
  const rejected = [
    ['吸力档位不存在', await command(member, vacuumId, 'set_fan_speed', { value: 'ludicrous' }), 400],
    ['没对应分区的房间', await command(member, vacuumId, 'clean_area', { value: ['bedroom'] }), 400],
    ['房间列表为空', await command(member, vacuumId, 'clean_area', { value: [] }), 400],
    ['选项不存在', await command(member, vacuumId, 'select_option', { entityId: 'select.roborock_s8_mop_intensity', value: 'ultra' }), 400],
    ['数值不在步长上', await command(member, vacuumId, 'set_value', { entityId: 'number.roborock_s8_volume', value: 55.5 }), 400],
    ['数值越界', await command(member, vacuumId, 'set_value', { entityId: 'number.roborock_s8_volume', value: 101 }), 400],
    ['排除的「重置」按钮', await command(member, vacuumId, 'press', { entityId: 'button.roborock_s8_reset_filter' }), 403],
    ['排除的 restart 按钮', await command(member, vacuumId, 'press', { entityId: 'button.roborock_s8_reboot' }), 403],
    ['诊断类传感器没有动作', await command(member, vacuumId, 'turn_on', { entityId: 'sensor.roborock_s8_filter_left' }), 400],
    ['别的设备的实体', await command(member, vacuumId, 'turn_on', { entityId: 'switch.dehumidify_box' }), 404],
    ['动作和实体对不上', await command(member, vacuumId, 'press', { entityId: 'select.roborock_s8_mop_intensity' }), 400],
  ];
  for (const [label, result, status] of rejected) {
    assert(result.status === status, `${label}：${status}${result.body?.error ? `（${result.body.error.message}）` : ''}`);
  }
  assert(ha.serviceCalls.length === before, '被拒的一条都没发到 HA');
  assert(
    rejected[6][1].body.error.message === '此操作请在厂商 App 完成',
    '排除项的拒绝原因：此操作请在厂商 App 完成',
  );

  console.log('4. 空调、窗帘');
  await patch(acId, { controllable: true, minRole: 'admin' });
  const ac = (await panel(acId)).body.data.primary;
  assert(
    ac.control.kind === 'climate' &&
      ac.control.hvacModes.map((one) => one.label).join('/') === '制冷/制热/送风/自动' &&
      ac.control.step === 1 &&
      ac.control.fanModes.map((one) => one.value).join('/') === '自动/低/中/高' &&
      ac.control.swingModes.map((one) => one.label).join('/') === '关/上下摆' &&
      ac.state.fanMode === '自动' &&
      ac.state.humidity === 58,
    '空调：模式（不含关）、步长按 target_temp_step、风速（HA 本来就给中文）、摆风、当前风速与湿度',
  );
  const acCases = [
    ['set_temperature', 27, 201, 'set_temperature'],
    ['set_fan_mode', '高', 201, 'set_fan_mode'],
    ['set_swing_mode', 'vertical', 201, 'set_swing_mode'],
    ['set_hvac_mode', 'cool', 201, 'set_hvac_mode'],
  ];
  for (const [action, value, status, service] of acCases) {
    const result = await command(owner, acId, action, { value });
    assert(result.status === status && lastCall().service === service, `空调 ${action}(${value}) → climate.${service}`);
  }
  const acBad = await Promise.all([
    command(owner, acId, 'set_temperature', { value: 26.5 }),
    command(owner, acId, 'set_temperature', { value: 31 }),
    command(owner, acId, 'set_hvac_mode', { value: 'dry' }),
    command(owner, acId, 'set_fan_mode', { value: 'turbo' }),
    command(member, acId, 'set_fan_mode', { value: '低' }),
  ]);
  assert(
    acBad.map((one) => one.status).join(',') === '400,400,400,400,403',
    '温度不在步长上 / 超上限、没有的模式、没有的风速：400；只给管理员的空调，成员 403',
  );
  await patch(curtainId, { controllable: true });
  const cover = (await panel(curtainId)).body.data.primary.control;
  const moved = await command(owner, curtainId, 'set_position', { value: 40 });
  const coverBad = await Promise.all([
    command(owner, curtainId, 'set_position', { value: 40.5 }),
    command(owner, curtainId, 'set_position', { value: 150 }),
  ]);
  assert(
    cover.kind === 'cover' && cover.position === true && JSON.stringify(cover.actions) === JSON.stringify(['open', 'stop', 'close']) &&
      moved.status === 201 && lastCall().service === 'set_cover_position' && lastCall().data.position === 40 &&
      coverBad.every((one) => one.status === 400),
    '窗帘：有 SET_POSITION 和 current_position 才出位置滑块；开到 40% → set_cover_position；小数、越界 400',
  );
  await wait(2_100);
  const curtainState = (await panel(curtainId)).body.data.primary.state;
  assert(curtainState.position === 40 && typeof curtainState.lastUpdated === 'string', '回推后面板读到新位置（lastUpdated 跟着变）');

  console.log('5. 藏掉、HA 新冒出来的实体');
  await patch(vacuumId, { hiddenEntityIds: ['number.roborock_s8_volume'] });
  const hiddenPanel = (await panel(vacuumId)).body.data;
  const hiddenCommand = await command(owner, vacuumId, 'set_value', { entityId: 'number.roborock_s8_volume', value: 30 });
  assert(
    !ids(hiddenPanel.more).includes('number.roborock_s8_volume') &&
      hiddenPanel.catalog.find((one) => one.entityId === 'number.roborock_s8_volume').hidden === true &&
      hiddenCommand.status === 404,
    '管理员藏掉的子实体：面板不出、命令 404；目录里标着「已藏」可以再放出来',
  );
  ha.entityRegistry = [
    ...ha.entityRegistry,
    { entity_id: 'switch.roborock_s8_new_feature', device_id: 'dev_roborock', area_id: null, entity_category: null, disabled_by: null, hidden_by: null },
  ];
  ha.states = [
    ...ha.states,
    { entity_id: 'switch.roborock_s8_new_feature', state: 'off', attributes: { friendly_name: 'Roborock S8 新功能' }, last_changed: new Date().toISOString() },
  ];
  await wait(2_100);
  await request('/smart-home/connector-settings', owner, 'PUT', { isEnabled: true }); // 丢掉注册表缓存
  const withNew = (await panel(vacuumId)).body.data;
  const memberNew = (await panel(vacuumId, member)).body.data;
  const newCommand = await command(owner, vacuumId, 'turn_on', { entityId: 'switch.roborock_s8_new_feature' });
  assert(
    withNew.pending.map((one) => one.name).join() === '新功能' &&
      !ids(withNew.more).includes('switch.roborock_s8_new_feature') &&
      memberNew.pending.length === 0 &&
      newCommand.status === 403,
    'HA 新冒出来的子实体默认藏着：管理员看到「1 个新实体待确认」，成员看不到，命令 403',
  );
  const accepted = await patch(vacuumId, { acceptEntityIds: ['switch.roborock_s8_new_feature'] });
  const afterAccept = (await panel(vacuumId)).body.data;
  const nowWorks = await command(owner, vacuumId, 'turn_on', { entityId: 'switch.roborock_s8_new_feature' });
  const badAccept = await patch(vacuumId, { acceptEntityIds: ['switch.dehumidify_box'] });
  assert(
    accepted.status === 200 && ids(afterAccept.more).includes('switch.roborock_s8_new_feature') && afterAccept.pending.length === 0 &&
      nowWorks.status === 201 && badAccept.status === 400,
    '管理员确认后放出来、能控；不能确认别的设备的实体',
  );

  console.log('6. 「允许控制」：主实体能控，或者有能控的子实体');
  const sensorPrimary = await patch(boxId, { primaryEntityId: 'sensor.dehumidify_box_power', controllable: true });
  const purifierControl = await patch(purifierId, { controllable: true });
  const boxPanel = (await panel(boxId)).body.data;
  const boxSwitch = await command(owner, boxId, 'turn_off', { entityId: 'switch.dehumidify_box' });
  assert(
    sensorPrimary.status === 200 && sensorPrimary.body.data.controllable === true &&
      boxPanel.primary.control === null && ids(boxPanel.more).includes('switch.dehumidify_box') &&
      boxSwitch.status === 201 && purifierControl.status === 400,
    '主实体是功率传感器的插座：有开关子实体，可以开放控制，开关在「更多设置」里能按；净水器一个能控的都没有，仍然 400',
  );

  console.log('7. 趋势、最近操作');
  const history = await request(`/smart-home/devices/${vacuumId}/history?entityId=sensor.roborock_s8_cleaning_area`, member);
  const historyBad = await Promise.all([
    request(`/smart-home/devices/${vacuumId}/history?entityId=sensor.kitchen_purifier_tds`, member),
    request(`/smart-home/devices/${vacuumId}/history?entityId=vacuum.roborock_s8`, member),
  ]);
  assert(
    history.status === 200 && history.body.data.unit === 'm²' && history.body.data.points.length === 3 &&
      history.body.data.points.every((point) => typeof point.value === 'number') &&
      historyBad[0].status === 404 && historyBad[1].status === 200 && historyBad[1].body.data.points.length === 0,
    '24 小时趋势：数值传感器给点（成员也能看）；别的设备的实体 404；不是数值的给空',
  );
  const recent = (await panel(vacuumId, member)).body.data.recent;
  assert(
    recent.length === 3 && recent[0].entityId === 'switch.roborock_s8_new_feature' && recent[0].memberName === '爸爸' &&
      recent.every((one) => one.deviceId === vacuumId),
    '最近 3 条操作全家可见（新的在前，只这台设备的）',
  );

  console.log('8. HA 断开');
  await ha.stop();
  await wait(2_100);
  const down = await panel(vacuumId);
  const downCommand = await command(owner, vacuumId, 'set_fan_speed', { value: 'quiet' });
  assert(
    down.status === 200 && down.body.data.stale === true && down.body.data.canControl === false &&
      down.body.data.primary.control === null && down.body.data.primary.state.state === 'cleaning' &&
      down.body.data.more.every((entity) => entity.control === null) &&
      downCommand.status === 502,
    'HA 断开：面板照开，保留上次的状态、控件全部收起；子实体命令 502',
  );
  await ha.start();

  console.log('\n智能家居 R1b 详情面板黑盒全部通过');
} finally {
  await db.query(`DELETE FROM smart_home_commands`);
  await db.query(`DELETE FROM smart_home_devices WHERE "householdId" IN (SELECT "householdId" FROM members WHERE name = '爸爸')`);
  await db.query(`DELETE FROM integrations WHERE kind = 'home_assistant'`);
  await ha.stop();
  await db.end();
}
