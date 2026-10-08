// I3 小管家只读工具：find_item / list_location_contents（item-location-plan §3 I3）。
// 口径是「上次放在 …」：位置是家里人上次记下的，不是清点结果，回答不能说成「在 …」。
// J4.1 起经位置门面读（原来直接调 locations 目录的纯函数）。
import { z } from 'zod';
import { defineTool, type AgentToolDeps } from './context';

const PHRASING = '回答时一律说「上次放在 …」，不要说「在 …」「就在 …」：位置是家里人上次记下的，可能已经挪过';

export const findItemTool = (deps: AgentToolDeps) =>
  defineTool({
    name: 'find_item',
    description: '这是查询某样东西（库存物品、食材批次、家庭资产）上次放在哪的唯一数据来源。用户问“XX 放哪了”“XX 在哪”时必须调用本工具；回答一律说“上次放在 …”，不得说成“在 …”，也不得凭对话历史猜位置',
    kind: 'read',
    schema: z.object({
      name: z.string().min(1).max(40),
    }),
    async execute({ user }, input) {
      const name = typeof input.name === 'string' ? input.name.trim().slice(0, 40) : '';
      if (!name) return { error: 'name_required', message: '缺少要找的东西的名字' };
      const hits = await deps.facades.get('locations').findItemLocations(user.householdId, name);
      return {
        query: name,
        answerStyle: PHRASING,
        found: hits.length,
        items: hits.map((hit) => ({
          name: hit.name,
          type: hit.type === 'asset' ? '资产' : hit.type === 'batch' ? '一批库存' : '库存物品（平时放的地方）',
          lastPlacedAt: `上次放在 ${hit.pathLabel}`,
          pathLabel: hit.pathLabel,
          detail: hit.detail,
          lastStockedOn: hit.placedOn,
          targetPath: `/house/map?${new URLSearchParams({ focus: hit.locationId, q: hit.name })}`,
        })),
        note: hits.length ? null : '没有记过位置的同名东西；可以请家里人入库时选一下「放哪儿」',
        untrustedContent: true,
      };
    },
  });

export const listLocationContentsTool = (deps: AgentToolDeps) =>
  defineTool({
    name: 'list_location_contents',
    description: '这是查询某个位置（房间、柜子、层格）里记着哪些东西的唯一数据来源。用户问“XX 柜里有什么”时必须调用本工具；locationName 可以是名字或「客厅 / 电视柜」这样的路径；同名位置有多个时按返回的候选追问用户，不得自行挑选',
    kind: 'read',
    schema: z.object({
      locationName: z.string().min(1).max(80),
    }),
    async execute({ user }, input) {
      const wanted = typeof input.locationName === 'string' ? input.locationName.trim().slice(0, 80) : '';
      if (!wanted) return { error: 'location_name_required', message: '缺少位置名字（比如「客厅 / 电视柜」或「电视柜」）' };
      const locations = deps.facades.get('locations');
      const tree = (await locations.listLocationPaths(user.householdId)).filter((one) => !one.archived);
      const normalized = wanted.replace(/\s*[/／]\s*/g, ' / ');
      const exact = tree.filter((one) => one.pathLabel === normalized || one.name === wanted);
      const matches = exact.length ? exact : tree.filter((one) => one.pathLabel.includes(wanted) || one.name.includes(wanted));
      if (!matches.length) {
        return { error: 'location_not_found', message: `没有叫「${wanted}」的位置`, candidates: tree.slice(0, 20).map((one) => one.pathLabel) };
      }
      if (matches.length > 1) {
        return {
          error: 'location_ambiguous',
          message: `有好几个位置叫「${wanted}」，请用户说是哪一个`,
          candidates: matches.slice(0, 10).map((one) => one.pathLabel),
        };
      }
      const [target] = matches;
      const pathOf = new Map(tree.map((one) => [one.id, one.pathLabel]));
      const contents = await locations.listContents(user.householdId, target.id);
      return {
        location: target.pathLabel,
        answerStyle: PHRASING,
        items: [
          ...contents.batches.map((one) => ({
            name: one.itemName,
            amount: `${Number(one.quantity)} ${one.unit}`,
            expiresOn: one.expiresOn,
            lastPlacedAt: `上次放在 ${pathOf.get(one.locationId) ?? target.pathLabel}`,
          })),
          ...contents.items.map((one) => ({
            name: one.name,
            amount: `${Number(one.quantity)} ${one.unit}`,
            expiresOn: null,
            lastPlacedAt: `平时放在 ${pathOf.get(one.locationId) ?? target.pathLabel}`,
          })),
          ...contents.assets.map((one) => ({
            name: one.name,
            amount: null,
            expiresOn: null,
            lastPlacedAt: `上次放在 ${pathOf.get(one.locationId) ?? target.pathLabel}`,
          })),
        ],
        targetPath: `/house/map?${new URLSearchParams({ focus: target.id })}`,
        untrustedContent: true,
      };
    },
  });
