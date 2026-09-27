const CONTINENTS: Record<string, string> = {
  Africa: '非洲',
  America: '美洲',
  Antarctica: '南极',
  Arctic: '北极',
  Asia: '亚洲',
  Atlantic: '大西洋',
  Australia: '大洋洲',
  Europe: '欧洲',
  Indian: '印度洋',
  Pacific: '太平洋',
};

/** 运行时没有 timeZone 的 DisplayNames。城市优先用这张表，其余用 shortGeneric 去掉「时间」。 */
const CITY: Record<string, string> = {
  Shanghai: '上海', Beijing: '北京', Chongqing: '重庆', Hong_Kong: '香港', Macau: '澳门', Taipei: '台北',
  Tokyo: '东京', Seoul: '首尔', Singapore: '新加坡', Bangkok: '曼谷', Kolkata: '加尔各答', Dubai: '迪拜',
  London: '伦敦', Paris: '巴黎', Berlin: '柏林', Rome: '罗马', Madrid: '马德里', Moscow: '莫斯科',
  New_York: '纽约', Los_Angeles: '洛杉矶', Chicago: '芝加哥', Denver: '丹佛', Phoenix: '凤凰城',
  Toronto: '多伦多', Vancouver: '温哥华', Mexico_City: '墨西哥城', Sao_Paulo: '圣保罗',
  Sydney: '悉尼', Melbourne: '墨尔本', Auckland: '奥克兰',
};

export function timeZoneLabel(zone: string) {
  const city = zone.split('/').at(-1) ?? zone;
  if (CITY[city]) return CITY[city];
  try {
    const name = new Intl.DateTimeFormat('zh-CN', { timeZone: zone, timeZoneName: 'shortGeneric' })
      .formatToParts(new Date())
      .find((part) => part.type === 'timeZoneName')?.value
      ?.replace(/时间$/, '');
    if (name && !/^(中国|日本|英国|法国|德国|俄罗斯|澳大利亚|加拿大|巴西|印度|韩国)$/.test(name)) return name;
  } catch {
    /* 落到城市标识 */
  }
  return city.replaceAll('_', ' ');
}

export function timeZoneGroups() {
  const zones = typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : ['Asia/Shanghai'];
  const groups = new Map<string, { zone: string; label: string }[]>();
  for (const zone of zones) {
    const continent = CONTINENTS[zone.split('/')[0] ?? ''] ?? '其他';
    const list = groups.get(continent) ?? [];
    list.push({ zone, label: timeZoneLabel(zone) });
    groups.set(continent, list);
  }
  return [...groups.entries()]
    .map(([continent, list]) => ({
      continent,
      list: list.sort((a, b) => a.label.localeCompare(b.label, 'zh-CN')),
    }))
    .sort((a, b) => a.continent.localeCompare(b.continent, 'zh-CN'));
}

export function deviceTimeZone() {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    new Intl.DateTimeFormat('en-US', { timeZone: zone }).format();
    return zone;
  } catch {
    return 'Asia/Shanghai';
  }
}
