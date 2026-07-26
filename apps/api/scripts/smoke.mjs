// 冒烟测试：妈妈点 3 道菜 → 爸爸接单 2 道 → 生成购物清单 → 验证合并与常备过滤
const BASE = process.env.API_URL || 'http://localhost:3100';
const today = new Date().toISOString().slice(0, 10);

let token = null;
async function api(path, method = 'GET', body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${JSON.stringify(json)}`);
  return json.data;
}

function assert(cond, msg) {
  if (!cond) throw new Error(`断言失败: ${msg}`);
  console.log(`  ✓ ${msg}`);
}

const members = await api('/members');
const mom = members.find((m) => m.name === '妈妈');
const dad = members.find((m) => m.role === 'chef');

console.log('0. 清场：划掉今天已有的菜（保证可重复跑）');
({ token } = await api('/auth/login', 'POST', { memberId: dad.id }));
for (const meal of await api(`/menus?date=${today}`)) {
  for (const item of meal.items) {
    if (item.status !== 'rejected') {
      await api(`/menu-items/${item.id}`, 'PATCH', { status: 'rejected' });
    }
  }
}

console.log('1. 妈妈登录点菜');
({ token } = await api('/auth/login', 'POST', { memberId: mom.id }));
const dishes = await api('/dishes');
assert(dishes.length >= 15, `菜谱库有 ${dishes.length} 道菜`);

// 选番茄炒蛋 + 番茄鸡蛋面（食材重叠,验证合并）+ 麻婆豆腐（带备注）
const pick = ['番茄炒蛋', '番茄鸡蛋面', '麻婆豆腐'].map((n) => dishes.find((d) => d.name === n));
assert(pick.every(Boolean), '找到 3 道目标菜');

const menu = await api(`/menus?date=${today}&mealType=dinner`);
await api(`/menus/${menu.id}/items`, 'POST', {
  items: [
    { dishId: pick[0].id },
    { dishId: pick[1].id },
    { dishId: pick[2].id, note: '少辣' },
  ],
});
const menuAfter = await api(`/menus?date=${today}&mealType=dinner`);
assert(menuAfter.items.length >= 3, `晚餐菜单有 ${menuAfter.items.length} 道菜`);
assert(menuAfter.items.some((i) => i.note === '少辣'), '备注「少辣」已保存');

console.log('2. 爸爸登录接单');
({ token } = await api('/auth/login', 'POST', { memberId: dad.id }));
const ours = menuAfter.items.slice(-3);
await api(`/menu-items/${ours[0].id}`, 'PATCH', { status: 'accepted' });
await api(`/menu-items/${ours[1].id}`, 'PATCH', { status: 'accepted' });
await api(`/menu-items/${ours[2].id}`, 'PATCH', { status: 'rejected' });
console.log('  ✓ 接单 2 道（番茄炒蛋+番茄鸡蛋面），划掉 1 道（麻婆豆腐）');

console.log('3. 生成购物清单');
const list = await api('/shopping-list/generate', 'POST', { date: today });
const names = list.map((i) => i.ingredient?.name ?? i.customName);
console.log(`  清单: ${list.map((i) => `${i.ingredient?.name}×${Number(i.totalQty)}${i.unit}`).join(', ')}`);

// 番茄炒蛋(番茄2/鸡蛋3/葱/糖) + 番茄鸡蛋面(面2/番茄2/鸡蛋2)；葱糖是常备调料
const tomato = list.find((i) => i.ingredient?.name === '番茄');
const egg = list.find((i) => i.ingredient?.name === '鸡蛋');
assert(tomato && Number(tomato.totalQty) === 4, '番茄合并为 4 个 (2+2)');
assert(egg && Number(egg.totalQty) === 5, '鸡蛋合并为 5 个 (3+2)');
assert(!names.includes('葱') && !names.includes('糖'), '常备调料（葱/糖）不进清单');
assert(!names.includes('豆腐'), '被划掉的麻婆豆腐食材不进清单');

console.log('4. 勾选与手动加项');
await api(`/shopping-items/${tomato.id}`, 'PATCH', { checked: true });
await api('/shopping-items', 'POST', { date: today, customName: '垃圾袋' });
const finalList = await api(`/shopping-list?date=${today}`);
assert(finalList.find((i) => i.id === tomato.id)?.checked === true, '番茄已勾选');
assert(finalList.some((i) => i.customName === '垃圾袋'), '手动项「垃圾袋」已添加');

// 重新生成后勾选状态保留
const regen = await api('/shopping-list/generate', 'POST', { date: today });
assert(
  regen.find((i) => i.ingredient?.name === '番茄')?.checked === true,
  '重新生成后勾选状态保留',
);

console.log('\n全部通过 ✅');
