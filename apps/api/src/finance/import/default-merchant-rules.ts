// K1 内置的商户关键词 → 默认分类（docs/finance-plan.md §2.3）。不入库；家庭自己的规则（finance_merchant_rules）优先。
// 关键词按归一化后的商户名（见 normalizeMerchant）「包含」判，也看商品说明；从上往下第一个命中的算。
// 右边是 K0 默认分类的 systemKey（finance.service.ts 的 DEFAULT_CATEGORIES）。

export const DEFAULT_MERCHANT_RULES: readonly { systemKey: string; keywords: readonly string[] }[] = [
  // 宠物排在医疗前面：「宠物医院」是宠物
  { systemKey: 'expense_pet', keywords: ['宠物'] },
  { systemKey: 'expense_food', keywords: ['美团', '饿了么', '肯德基', '麦当劳', '星巴克', '瑞幸', '喜茶', '必胜客', '外卖', '餐厅', '饭店', '面馆'] },
  { systemKey: 'expense_transport', keywords: ['滴滴', '高德', '地铁', '公交', '曹操出行', '哈啰', '铁路', '12306', '航空', '加油', '石化', '停车', 'etc'] },
  { systemKey: 'expense_utilities', keywords: ['国家电网', '电力', '供电', '燃气', '水务', '自来水', '热力'] },
  { systemKey: 'expense_telecom', keywords: ['中国移动', '中国联通', '中国电信', '移动', '联通', '电信', '宽带'] },
  { systemKey: 'expense_health', keywords: ['药房', '药店', '医药', '医院', '诊所', '卫生院'] },
  { systemKey: 'expense_housing', keywords: ['物业', '房租', '自如', '链家', '贝壳'] },
  { systemKey: 'expense_entertainment', keywords: ['爱奇艺', '腾讯视频', '优酷', '芒果', '网易云音乐', 'qq音乐', '电影', '猫眼', '淘票票'] },
  { systemKey: 'expense_education', keywords: ['学校', '培训', '课程', '学而思', '新东方'] },
  { systemKey: 'expense_insurance', keywords: ['保险'] },
  { systemKey: 'expense_shopping', keywords: ['京东', '淘宝', '天猫', '拼多多', '唯品会', '超市', '便利店', '便利蜂', '盒马', '永辉'] },
];

/** 收入：按对方 / 商品说明里的字判（退款排最前）。 */
export const DEFAULT_INCOME_RULES: readonly { systemKey: string; keywords: readonly string[] }[] = [
  { systemKey: 'income_refund', keywords: ['退款'] },
  { systemKey: 'income_red_packet', keywords: ['红包'] },
  { systemKey: 'income_salary', keywords: ['工资', '薪'] },
  { systemKey: 'income_investment', keywords: ['收益', '利息', '理财', '余额宝', '零钱通'] },
  { systemKey: 'income_reimbursement', keywords: ['报销'] },
];
