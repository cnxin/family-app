import pg from 'pg';

const { Client } = pg;
const BASE = process.env.API_URL || 'http://127.0.0.1:3100';
const VISIT_DATE = '2200-02-02';

function assert(condition, message) {
  if (!condition) throw new Error(`断言失败: ${message}`);
  console.log(`  ✓ ${message}`);
}

async function request(path, token, method = 'GET', body) {
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body == null ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

async function login(loginName) {
  const response = await request('/auth/login', null, 'POST', {
    loginName,
    password: 'family1234',
  });
  if (response.status !== 201) throw new Error(`${loginName} 登录失败`);
  return response.body.data.token;
}

const adminToken = await login('爸爸');
const memberToken = await login('妈妈');

const memberRead = await request('/guests', memberToken);
assert(memberRead.status === 403, '普通成员不能读取访客目录');

const memberWifiRead = await request('/guest-wifi-profiles', memberToken);
assert(memberWifiRead.status === 403, '普通成员不能读取或管理访客 Wi-Fi 配置');

const invalidWifi = await request('/guest-wifi-profiles', adminToken, 'POST', {
  name: '无效网络',
  ssid: 'Family-Guest',
  security: 'WPA',
  password: 'short',
});
assert(invalidWifi.status === 400, 'WPA 访客 Wi-Fi 拒绝弱密码');

const wifiCreated = await request('/guest-wifi-profiles', adminToken, 'POST', {
  name: '验收访客网络',
  ssid: 'Family-Guest-Test',
  security: 'WPA',
  password: 'guest-pass-2468',
});
const wifiProfile = wifiCreated.body.data;
assert(
  wifiCreated.status === 201 &&
    wifiProfile.passwordConfigured === true &&
    !('password' in wifiProfile) &&
    !('passwordEncrypted' in wifiProfile),
  '访客 Wi-Fi 管理响应不返回密码或密文',
);

const database = new Client({
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 5433),
  user: process.env.DB_USER || 'family',
  password: process.env.DB_PASSWORD || 'family123',
  database: process.env.DB_NAME,
});
await database.connect();
const encryptedPassword = await database.query(
  'SELECT "passwordEncrypted" FROM "guest_wifi_profiles" WHERE "id" = $1',
  [wifiProfile.id],
);
await database.end();
assert(
  encryptedPassword.rows[0]?.passwordEncrypted?.startsWith('v1:') &&
    encryptedPassword.rows[0].passwordEncrypted !== 'guest-pass-2468',
  '访客 Wi-Fi 密码以家庭范围的加密密文保存',
);

const guestCreated = await request('/guests', adminToken, 'POST', {
  name: '访客验收小林',
  avatarEmoji: '🪴',
  note: '不吃香菜',
});
assert(guestCreated.status === 201, '管理员可以创建独立访客档案');
const guest = guestCreated.body.data;

const invalidVisit = await request('/visits', adminToken, 'POST', {
  title: '无效来访',
  startsAt: `${VISIT_DATE}T19:00:00.000Z`,
  endsAt: `${VISIT_DATE}T18:00:00.000Z`,
  guestIds: [guest.id],
});
assert(invalidVisit.status === 400, '来访计划拒绝倒置时间范围');

const created = await request('/visits', adminToken, 'POST', {
  title: '访客验收晚餐',
  startsAt: `${VISIT_DATE}T10:30:00.000Z`,
  endsAt: `${VISIT_DATE}T13:00:00.000Z`,
  note: '请在门铃处确认',
  guestIds: [guest.id],
  guestWifiProfileId: wifiProfile.id,
});
assert(
  created.status === 201 &&
    created.body.data.guests[0]?.guest.id === guest.id &&
    created.body.data.guestWifiProfile?.id === wifiProfile.id,
  '管理员可以将加密的访客 Wi-Fi 配置绑定到单次来访',
);
const visit = created.body.data;

const dishes = await request('/dishes', adminToken);
const visitMenu = await request(`/menus?date=${VISIT_DATE}&mealType=dinner`, adminToken);
const visitMenuItems = await request(`/menus/${visitMenu.body.data.id}/items`, adminToken, 'POST', {
  items: [{ dishId: dishes.body.data[0].id }],
});
assert(
  dishes.status === 200 && visitMenu.status === 200 && visitMenuItems.status === 201 && visitMenuItems.body.data.items.length === 1,
  '家庭可以先安排本次来访的正式菜单',
);
const visitMenuItem = visitMenuItems.body.data.items[0];

const calendar = await request(`/calendar?start=${VISIT_DATE}&end=${VISIT_DATE}`, adminToken);
assert(
  calendar.status === 200 && calendar.body.data.some((entry) => entry.module === 'guest' && entry.sourceId === visit.id),
  '统一日历聚合已安排的来访计划',
);

// 上海家庭 07:00 是前一个 UTC 日期的 23:00；来访归家庭日期，不归 UTC 前一天。
const morningStartsAt = new Date(`${VISIT_DATE}T00:00:00.000Z`);
morningStartsAt.setUTCHours(morningStartsAt.getUTCHours() - 1);
const previousDate = morningStartsAt.toISOString().slice(0, 10);
const morningVisit = await request('/visits', adminToken, 'POST', {
  title: '清晨来访日界', startsAt: morningStartsAt.toISOString(), guestIds: [guest.id],
});
assert(morningVisit.status === 201, '清晨来访安排成功');
const [onFamilyDay, onPreviousDay] = await Promise.all([
  request(`/calendar?start=${VISIT_DATE}&end=${VISIT_DATE}`, adminToken),
  request(`/calendar?start=${previousDate}&end=${previousDate}`, adminToken),
]);
assert(
  onFamilyDay.body.data.some((row) => row.module === 'guest' && row.sourceId === morningVisit.body.data.id && row.date === VISIT_DATE) &&
    !onPreviousDay.body.data.some((row) => row.module === 'guest' && row.sourceId === morningVisit.body.data.id),
  '上海 07:00 的来访在当天日历可见，前一天日历不出现',
);
const morningInvite = await request(`/visits/${morningVisit.body.data.id}/invitations`, adminToken, 'POST', {
  guestId: guest.id, expiresInHours: 24, allowsMealRequests: true,
});
assert(morningInvite.status === 201, '清晨来访邀请创建成功');
const morningToken = morningInvite.body.data.invitationToken;
const morningPreview = await request(`/guest-invitations/${morningToken}`, null);
const morningOptions = await request(`/guest-invitations/${morningToken}/meal-options`, null);
assert(
  morningPreview.body.data.mealRequestDates.includes(VISIT_DATE) &&
    !morningPreview.body.data.mealRequestDates.includes(previousDate) &&
    morningOptions.body.data.some((menu) => menu.mealDate === VISIT_DATE && menu.items.some((item) => item.id === visitMenuItem.id)),
  '上海 07:00 当天可点菜，不误归到前一天',
);
await request(`/visits/${morningVisit.body.data.id}`, adminToken, 'PATCH', { status: 'cancelled' });

const moviePollCreated = await request('/polls', adminToken, 'POST', {
  title: '访客观影验收投票',
  category: 'movie',
  voteMode: 'single',
  options: [
    { label: '家庭电影甲' },
    { label: '家庭电影乙' },
  ],
});
assert(moviePollCreated.status === 201, '管理员可以创建供访客参与的观影投票');
const moviePoll = moviePollCreated.body.data;

const invitationCreated = await request(`/visits/${visit.id}/invitations`, adminToken, 'POST', {
  guestId: guest.id,
  expiresInHours: 24,
  allowsMovieVoting: true,
  allowsMealRequests: true,
});
const invitation = invitationCreated.body.data;
assert(
  invitationCreated.status === 201 && typeof invitation.invitationToken === 'string' && !('tokenHash' in invitation),
  '邀请仅在创建时返回明文令牌，响应不含摘要',
);

const preview = await request(`/guest-invitations/${invitation.invitationToken}`, null);
assert(
  preview.status === 200 &&
    preview.body.data.guest.name === guest.name &&
    preview.body.data.visit.title === visit.title &&
    preview.body.data.capabilities?.movieVoting === true &&
    preview.body.data.capabilities?.mealRequests === true &&
    preview.body.data.wifi?.ssid === wifiProfile.ssid &&
    typeof preview.body.data.wifi?.qrPayload === 'string' &&
    !('hostMember' in preview.body.data) &&
    !('householdId' in preview.body.data) &&
    !('password' in (preview.body.data.wifi ?? {})) &&
    !('tokenHash' in preview.body.data),
  '公开邀请页只返回本次来访的 Wi-Fi 二维码载荷，不返回密码字段、家庭成员或令牌摘要',
);

const moviePolls = await request(`/guest-invitations/${invitation.invitationToken}/movie-polls`, null);
assert(
  moviePolls.status === 200 &&
    moviePolls.body.data.some((poll) => poll.id === moviePoll.id) &&
    !('voters' in moviePolls.body.data.find((poll) => poll.id === moviePoll.id).options[0]),
  '经授权访客只能读取开放中的观影投票及匿名票数',
);
const guestMovieVote = await request(
  `/guest-invitations/${invitation.invitationToken}/movie-polls/${moviePoll.id}/votes`,
  null,
  'POST',
  { optionIds: [moviePolls.body.data.find((poll) => poll.id === moviePoll.id).options[0].id] },
);
assert(
  guestMovieVote.status === 201 && guestMovieVote.body.data.selectedOptionIds.length === 1,
  '经授权访客可以独立提交观影投票',
);
const moviePollAfterGuestVote = await request(`/polls/${moviePoll.id}`, adminToken);
assert(
  moviePollAfterGuestVote.status === 200 && moviePollAfterGuestVote.body.data.totalVoters === 1,
  '家庭投票统计会计入访客选票但不创建家庭成员身份',
);

const mealOptions = await request(`/guest-invitations/${invitation.invitationToken}/meal-options`, null);
assert(
  mealOptions.status === 200 && mealOptions.body.data[0]?.items.some((item) => item.id === visitMenuItem.id) && !('requestedBy' in mealOptions.body.data[0].items[0]),
  '访客只能查看本次来访期间的菜单菜品，不读取下单成员或菜谱详情',
);
const claimedMealOption = await request(
  `/guest-invitations/${invitation.invitationToken}/meal-options/${visitMenuItem.id}/request`,
  null,
  'POST',
);
assert(
  claimedMealOption.status === 201 && claimedMealOption.body.data.menuItemId === visitMenuItem.id,
  '访客可以从家庭菜单中选择菜品且保留独立请求身份',
);

const mealRequestsBefore = await request(`/guest-invitations/${invitation.invitationToken}/meal-requests`, null);
assert(
  mealRequestsBefore.status === 200 && mealRequestsBefore.body.data.length === 1,
  '经授权访客只能读取自己的点菜请求列表',
);
const mealRequest = await request(`/guest-invitations/${invitation.invitationToken}/meal-requests`, null, 'POST', {
  mealDate: VISIT_DATE,
  mealType: 'dinner',
  dishName: '清蒸鲈鱼',
  note: '少放辣椒',
});
assert(
  mealRequest.status === 201 && mealRequest.body.data.status === 'pending' && mealRequest.body.data.dishName === '清蒸鲈鱼',
  '访客可以提交独立点菜请求而不创建菜单项或成员身份',
);
const memberMealRequestReview = await request(`/guest-meal-requests/${mealRequest.body.data.id}`, memberToken, 'PATCH', {
  status: 'accepted',
});
assert(memberMealRequestReview.status === 403, '普通成员不能处理访客点菜请求');
const mealRequestReview = await request(`/guest-meal-requests/${mealRequest.body.data.id}`, adminToken, 'PATCH', {
  status: 'accepted',
  reviewNote: '晚餐安排',
});
assert(
  mealRequestReview.status === 200 && mealRequestReview.body.data.status === 'accepted',
  '家庭管理员可以接受访客点菜请求',
);
const mealRequestAfterReview = await request(`/guest-invitations/${invitation.invitationToken}/meal-requests`, null, 'POST', {
  mealDate: VISIT_DATE,
  mealType: 'dinner',
  dishName: '红烧肉',
});
assert(mealRequestAfterReview.status === 409, '已处理的访客点菜请求不能被访客覆盖');

const disabledWifi = await request(`/guest-wifi-profiles/${wifiProfile.id}`, adminToken, 'PATCH', { isActive: false });
const disabledWifiPreview = await request(`/guest-invitations/${invitation.invitationToken}`, null);
assert(
  disabledWifi.status === 200 && disabledWifiPreview.status === 200 && disabledWifiPreview.body.data.wifi === null,
  '停用 Wi-Fi 配置后，仍有效邀请立即隐藏二维码',
);
await request(`/guest-wifi-profiles/${wifiProfile.id}`, adminToken, 'PATCH', { isActive: true });

const response = await request(
  `/guest-invitations/${invitation.invitationToken}/response`,
  null,
  'POST',
  { attending: true },
);
assert(
  response.status === 201 && response.body.data.response.attending === true,
  '访客无需登录即可确认参加',
);

const listed = await request('/visits?status=scheduled', adminToken);
assert(
  listed.status === 200 &&
    listed.body.data.find((entry) => entry.id === visit.id)?.guests[0]?.isAttending === true,
  '家庭侧只在自己的来访计划中看到访客确认结果',
);

const revoked = await request(`/guest-invitations/${invitation.id}`, adminToken, 'DELETE');
const expiredPreview = await request(`/guest-invitations/${invitation.invitationToken}`, null);
assert(
  revoked.status === 200 && revoked.body.data.revoked === true && expiredPreview.status === 404,
  '撤销邀请后公开链接立即失效',
);

const restrictedInvitationCreated = await request(`/visits/${visit.id}/invitations`, adminToken, 'POST', {
  guestId: guest.id,
});
const restrictedMoviePolls = await request(
  `/guest-invitations/${restrictedInvitationCreated.body.data.invitationToken}/movie-polls`,
  null,
);
assert(
  restrictedInvitationCreated.status === 201 && restrictedMoviePolls.status === 404,
  '未显式授权的访客邀请不能读取观影投票',
);
const restrictedMealRequests = await request(
  `/guest-invitations/${restrictedInvitationCreated.body.data.invitationToken}/meal-requests`,
  null,
);
assert(restrictedMealRequests.status === 404, '未显式授权的访客邀请不能读取点菜请求');

const scheduledAnonymize = await request(`/guests/${guest.id}/anonymize`, adminToken, 'POST');
assert(scheduledAnonymize.status === 409, '已安排来访期间不能匿名化访客资料');
const cancelled = await request(`/visits/${visit.id}`, adminToken, 'PATCH', { status: 'cancelled' });
assert(cancelled.status === 200 && cancelled.body.data.status === 'cancelled', '管理员可以结束或取消来访计划');

const memberAnonymize = await request(`/guests/${guest.id}/anonymize`, memberToken, 'POST');
assert(memberAnonymize.status === 403, '普通成员不能匿名化访客资料');
const anonymized = await request(`/guests/${guest.id}/anonymize`, adminToken, 'POST');
assert(
  anonymized.status === 201 &&
    anonymized.body.data.name === '已匿名访客' &&
    anonymized.body.data.note === null &&
    anonymized.body.data.isActive === false &&
    typeof anonymized.body.data.anonymizedAt === 'string',
  '取消来访后管理员可以匿名化访客资料并移除身份字段',
);
const reenableAnonymized = await request(`/guests/${guest.id}`, adminToken, 'PATCH', { isActive: true });
assert(reenableAnonymized.status === 409, '匿名化访客不能重新启用或编辑');

console.log('\n访客与来访测试全部通过');
