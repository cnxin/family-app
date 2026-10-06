// K1 账单导入的格式表（docs/finance-plan.md §3-K1）。解析器只认这张表，不在代码里写列名、状态词。
//
// 支付宝 / 微信改版时只改这里：
// - 列名对不上 → 往 columns 对应字段的候选名数组里加一个（先按「完全相等」找，找不到再按「包含」找）；
// - 「收/支」那一列出现了新写法 → 改 directions；
// - 交易状态出现了新写法 → 改 statuses（按「包含」判，没列到的都当成功）。

export type ImportSource = 'alipay' | 'wechat';

/** 解析器要的字段。左边是字段，右边在每种来源的 columns 里写这一列可能叫什么。 */
export type StatementField =
  | 'occurredAt'
  | 'platformCategory'
  | 'merchant'
  | 'title'
  | 'direction'
  | 'amount'
  | 'payMethod'
  | 'status'
  | 'externalId';

export interface StatementFormat {
  source: ImportSource;
  label: string;
  /** 文件编码：支付宝的「交易流水证明」是 GBK，微信是 UTF-8（可能带 BOM） */
  encoding: 'gbk' | 'utf-8';
  /** 表头前有若干行说明文字：从第一个含这个词的行开始算表头 */
  headerAnchor: string;
  /** 每个字段在表头里可能叫什么；按顺序先找完全相等、再找包含 */
  columns: Record<StatementField, readonly string[]>;
  /** 少了这些列就报错（说清楚缺哪列、认哪些名字）；其余列缺了只是没有这项信息 */
  required: readonly StatementField[];
  /** 「收/支」列的写法（去掉首尾空白后完全相等）；都对不上的当「不计收支」 */
  directions: { expense: readonly string[]; income: readonly string[]; notCounted: readonly string[] };
  /** 交易状态（包含即算）：退款、关闭；都不是的当成功 */
  statuses: { refund: readonly string[]; closed: readonly string[] };
  /** 平台自己的分类 / 交易类型 → 我们的默认分类 systemKey（商户关键词都没命中时用） */
  platformCategories: Readonly<Record<string, string>>;
  /** 页面上的导出路径说明 */
  exportHint: string;
}

export const STATEMENT_FORMATS: Readonly<Record<ImportSource, StatementFormat>> = {
  alipay: {
    source: 'alipay',
    label: '支付宝',
    encoding: 'gbk',
    headerAnchor: '交易时间',
    columns: {
      occurredAt: ['交易时间'],
      platformCategory: ['交易分类'],
      merchant: ['交易对方'],
      title: ['商品说明'],
      direction: ['收/支'],
      amount: ['金额'],
      payMethod: ['收/付款方式'],
      status: ['交易状态'],
      externalId: ['交易订单号'],
    },
    required: ['occurredAt', 'merchant', 'direction', 'amount', 'status', 'externalId'],
    directions: { expense: ['支出'], income: ['收入'], notCounted: ['不计收支', ''] },
    statuses: { refund: ['退款成功', '已全额退款'], closed: ['交易关闭', '已关闭', '失败', '等待付款'] },
    platformCategories: {
      餐饮美食: 'expense_food',
      交通出行: 'expense_transport',
      爱车养车: 'expense_transport',
      日用百货: 'expense_shopping',
      家居家装: 'expense_home',
      服饰装扮: 'expense_clothing',
      数码电器: 'expense_digital',
      医疗健康: 'expense_health',
      充值缴费: 'expense_utilities',
      通讯物流: 'expense_telecom',
      住房物业: 'expense_housing',
      教育培训: 'expense_education',
      母婴亲子: 'expense_childcare',
      宠物: 'expense_pet',
      酒店旅游: 'expense_travel',
      文化休闲: 'expense_entertainment',
      保险: 'expense_insurance',
      商业服务: 'expense_other',
    },
    exportHint: '支付宝 App → 我的 → 账单 → 右上角「…」→ 开具交易流水证明 → 用于个人对账，发到邮箱。邮件里的 zip 先解压，上传里面的 csv。',
  },
  wechat: {
    source: 'wechat',
    label: '微信',
    encoding: 'utf-8',
    headerAnchor: '交易时间',
    columns: {
      occurredAt: ['交易时间'],
      platformCategory: ['交易类型'],
      merchant: ['交易对方'],
      title: ['商品'],
      direction: ['收/支'],
      amount: ['金额(元)', '金额（元）', '金额'],
      payMethod: ['支付方式'],
      status: ['当前状态'],
      externalId: ['交易单号'],
    },
    required: ['occurredAt', 'merchant', 'direction', 'amount', 'status', 'externalId'],
    directions: { expense: ['支出'], income: ['收入'], notCounted: ['/', '不计收支', ''] },
    // 「已退款(¥5.00)」是部分退款，那笔消费还在，不算退款
    statuses: { refund: ['已全额退款', '退款成功'], closed: ['已关闭', '交易关闭', '失败', '未支付'] },
    platformCategories: {
      微信红包: 'income_red_packet',
      '微信红包（单发）': 'income_red_packet',
      '微信红包（群红包）': 'income_red_packet',
      退款: 'income_refund',
    },
    exportHint: '微信 → 我 → 服务 → 钱包 → 账单 → 常见问题 → 下载账单 → 用于个人对账，导出 csv 后上传。',
  },
};

/** 通用 CSV：用户自己指定这六列（单号、备注、收支可不选）。 */
export const GENERIC_FIELDS = ['occurredOn', 'amount', 'direction', 'merchant', 'note', 'externalId'] as const;
export type GenericField = (typeof GENERIC_FIELDS)[number];
export const GENERIC_REQUIRED: readonly GenericField[] = ['occurredOn', 'amount', 'merchant'];

/** 通用 CSV 的「收支」列：包含这些字就算；不选收支列时按金额正负（负数是支出）。 */
export const GENERIC_DIRECTIONS = {
  expense: ['支出', '支', '出', 'expense', 'debit'],
  income: ['收入', '收', '入', 'income', 'credit'],
} as const;

/** 上限（§3-K1）：文件 ≤ 5 MB、数据 ≤ 5000 行。 */
export const IMPORT_MAX_BYTES = 5 * 1024 * 1024;
export const IMPORT_MAX_ROWS = 5000;
export const IMPORT_TOO_LARGE = '文件超过 5 MB，分几次导出再导入';
