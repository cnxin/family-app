// J1b 单测（API 没有单测框架，和 check-schema-drift.ts 一样用 ts-node 跑、node:assert 断言）：
// 内核的门面注册表、事务内钩子注册表，以及从插件目录搬进 @family/shared 的两个纯函数。
// run-api-tests.mjs 全量模式里执行；单独跑：node -r ts-node/register scripts/kernel-units.check.ts
import assert from 'node:assert/strict';
import { buildRecipeSnapshot, taskOccursOn, type TaskRecurrenceRule } from '@family/shared';
import type { EntityManager } from 'typeorm';
import { InProcessEventBus } from '../src/events/event-bus';
import { PluginFacadeRegistry } from '../src/system/plugin-facades.registry';
import { TransactionHookRegistry } from '../src/system/transaction-hooks.registry';

let passed = 0;
async function check(name: string, run: () => void | Promise<void>) {
  await run();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

/** 单测用的名字不在 contracts 的名单里：门面 key / 钩子名都按 never 传，绕过类型。 */
const as = <T>(value: unknown) => value as T;
const fakeManager = as<EntityManager>({ tag: 'manager' });

class TestHooks extends TransactionHookRegistry {
  constructor(names: string[], order: Record<string, string[]> = {}) {
    super();
    this.names = new Set(names);
    this.order = order;
  }
}

void (async () => {
  console.log('门面注册表');
  await check('注册后按 key 取回同一个实现', () => {
    const registry = new PluginFacadeRegistry();
    const facade = { hello: () => 'hi' };
    registry.register(as<never>('demo'), as<never>(facade));
    assert.equal(registry.get(as<never>('demo')), facade);
  });
  await check('同一个 key 重复注册报错', () => {
    const registry = new PluginFacadeRegistry();
    registry.register(as<never>('demo'), as<never>({}));
    assert.throws(() => registry.register(as<never>('demo'), as<never>({})), /重复注册/);
  });
  await check('没注册就取报错', () => {
    assert.throws(() => new PluginFacadeRegistry().get(as<never>('missing')), /没有注册/);
  });

  console.log('事务内钩子注册表');
  await check('按注册顺序执行，拿到同一个 payload 与 manager', async () => {
    const hooks = new TestHooks(['demo.happened']);
    const calls: string[] = [];
    hooks.on(as<never>('demo.happened'), as<never>('points'), async (payload, manager) => {
      calls.push(`points:${(payload as { id: string }).id}:${(manager as unknown as { tag: string }).tag}`);
    });
    hooks.on(as<never>('demo.happened'), as<never>('smart-home'), async () => {
      calls.push('smart-home');
    });
    await hooks.run(as<never>('demo.happened'), as<never>({ id: 'x1' }), fakeManager);
    assert.deepEqual(calls, ['points:x1:manager', 'smart-home']);
    assert.deepEqual(hooks.subscribers(as<never>('demo.happened')), ['points', 'smart-home']);
  });
  await check('回调抛错原样向上抛，后面的回调不再执行', async () => {
    const hooks = new TestHooks(['demo.happened']);
    const calls: string[] = [];
    hooks.on(as<never>('demo.happened'), as<never>('points'), async () => {
      throw new Error('积分写失败');
    });
    hooks.on(as<never>('demo.happened'), as<never>('smart-home'), async () => {
      calls.push('smart-home');
    });
    await assert.rejects(hooks.run(as<never>('demo.happened'), as<never>({}), fakeManager), /积分写失败/);
    assert.deepEqual(calls, []);
  });
  await check('同一个插件重复订阅同一个钩子报错', () => {
    const hooks = new TestHooks(['demo.happened']);
    hooks.on(as<never>('demo.happened'), as<never>('points'), async () => undefined);
    assert.throws(() => hooks.on(as<never>('demo.happened'), as<never>('points'), async () => undefined), /重复订阅/);
  });
  await check('不认识的钩子名，订阅和发起都报错', async () => {
    const hooks = new TestHooks(['demo.happened']);
    assert.throws(() => hooks.on(as<never>('demo.unknown'), as<never>('points'), async () => undefined), /TRANSACTION_HOOK_NAMES/);
    await assert.rejects(hooks.run(as<never>('demo.unknown'), as<never>({}), fakeManager), /TRANSACTION_HOOK_NAMES/);
  });
  await check('没有订阅方时 run 什么也不做', async () => {
    await new TestHooks(['demo.happened']).run(as<never>('demo.happened'), as<never>({}), fakeManager);
  });
  await check('写死了顺序的钩子按写死的顺序执行，与注册先后无关；没写的按注册顺序排在后面', async () => {
    const hooks = new TestHooks(['demo.fired'], { 'demo.fired': ['tasks', 'reminders'] });
    const calls: string[] = [];
    for (const owner of ['shopping', 'reminders', 'media', 'tasks']) {
      hooks.on(as<never>('demo.fired'), as<never>(owner), async () => {
        calls.push(owner);
      });
    }
    await hooks.run(as<never>('demo.fired'), as<never>({}), fakeManager);
    assert.deepEqual(calls, ['tasks', 'reminders', 'shopping', 'media']);
  });
  await check('contracts 里 smart-home.link-fired 写死为 任务 → 提醒 → 购物', async () => {
    const hooks = new TransactionHookRegistry();
    const calls: string[] = [];
    for (const owner of ['shopping', 'reminders', 'tasks']) {
      hooks.on('smart-home.link-fired', as<never>(owner), async () => {
        calls.push(owner);
      });
    }
    await hooks.run('smart-home.link-fired', as<never>({}), fakeManager);
    assert.deepEqual(calls, ['tasks', 'reminders', 'shopping']);
  });

  console.log('内核事件总线上的插件事件');
  await check('emit 不等订阅方；订阅方异步收到同一个 payload，一个抛错不影响另一个，退订后收不到', async () => {
    const bus = new InProcessEventBus();
    const received: string[] = [];
    bus.on('tasks.completed', () => {
      throw new Error('订阅方出错');
    });
    const off = bus.on('tasks.completed', (event) => {
      received.push(event.taskId);
    });
    const payload = as<never>({ householdId: 'h', taskId: 't1', dueDate: '2026-10-06', title: '倒垃圾', actor: {} });
    bus.emit('tasks.completed', payload);
    assert.deepEqual(received, []);
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(received, ['t1']);
    off();
    bus.emit('tasks.completed', payload);
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(received, ['t1']);
  });

  console.log('taskOccursOn（搬到 @family/shared）');
  const rule = (overrides: Partial<TaskRecurrenceRule>): TaskRecurrenceRule => ({
    startsOn: '2026-10-01', endsOn: null, recurrence: 'once', repeatInterval: 1, ...overrides,
  });
  await check('一次性：只有开始那天', () => {
    assert.equal(taskOccursOn(rule({}), '2026-10-01'), true);
    assert.equal(taskOccursOn(rule({}), '2026-10-02'), false);
    assert.equal(taskOccursOn(rule({}), '2026-09-30'), false);
  });
  await check('每 2 天 / 每周 / 每月 / 结束日期', () => {
    assert.equal(taskOccursOn(rule({ recurrence: 'daily', repeatInterval: 2 }), '2026-10-05'), true);
    assert.equal(taskOccursOn(rule({ recurrence: 'daily', repeatInterval: 2 }), '2026-10-06'), false);
    assert.equal(taskOccursOn(rule({ recurrence: 'weekly' }), '2026-10-15'), true);
    assert.equal(taskOccursOn(rule({ recurrence: 'weekly' }), '2026-10-16'), false);
    assert.equal(taskOccursOn(rule({ recurrence: 'monthly' }), '2026-12-01'), true);
    assert.equal(taskOccursOn(rule({ recurrence: 'monthly', repeatInterval: 2 }), '2026-11-01'), false);
    assert.equal(taskOccursOn(rule({ recurrence: 'daily', endsOn: '2026-10-03' }), '2026-10-04'), false);
  });

  console.log('buildRecipeSnapshot（搬到 @family/shared）');
  await check('食材按名字排序、步骤与链接按位置排序、数量转数字', () => {
    const snapshot = buildRecipeSnapshot({
      id: 'v1', name: '家常做法', authorMemberId: 'm1', author: { name: '妈妈' }, note: null, estMinutes: 20,
      ingredients: [
        { ingredientId: 'i2', quantity: '2.50', unit: '个', ingredient: { name: '鸡蛋', category: '蛋奶', isPantryStaple: false } },
        { ingredientId: 'i1', quantity: '1', unit: '勺', ingredient: { name: '盐', category: '调料', isPantryStaple: true } },
      ],
      steps: [{ position: 2, text: '出锅' }, { position: 1, text: '打散', imageUrl: null }],
      referenceLinks: [{ position: 1, title: null, url: 'https://example.com/a' }],
    });
    assert.deepEqual(snapshot.ingredients.map((one) => [one.name, one.quantity]), [['鸡蛋', 2.5], ['盐', 1]]);
    assert.deepEqual(snapshot.steps.map((one) => one.text), ['打散', '出锅']);
    assert.deepEqual(snapshot.referenceLinks, [{ title: undefined, url: 'https://example.com/a' }]);
    assert.equal(snapshot.authorName, '妈妈');
  });

  console.log(`内核与共享纯函数单测全部通过（${passed} 条）`);
})().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
