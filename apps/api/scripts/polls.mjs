const BASE = process.env.API_URL || 'http://127.0.0.1:3100';

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
  const json = text ? JSON.parse(text) : null;
  return { status: response.status, data: json?.data, error: json?.error };
}

async function login(loginName) {
  const response = await request('/auth/login', null, 'POST', {
    loginName,
    password: 'family1234',
  });
  assert(response.status === 201, `${loginName}登录成功`);
  return response.data;
}

console.log('1. 创建通用投票与规则校验');
const mom = await login('妈妈');
const dad = await login('爸爸');
const createdPollIds = [];

try {
  const duplicateOptions = await request('/polls', mom.token, 'POST', {
    title: '重复候选项测试',
    options: [{ label: '公园' }, { label: '公园' }],
  });
  assert(duplicateOptions.status === 400, '拒绝重复候选项');

  // 以下两条守的是请求校验管道本身（polls 已从 class-validator DTO 换成契约 schema）：
  // 选项下限来自 createPollBody 的 .min(2)，原先是 @ArrayMinSize(2)。
  const tooFewOptions = await request('/polls', mom.token, 'POST', {
    title: '候选项不足测试',
    options: [{ label: '只有一个' }],
  });
  assert(tooFewOptions.status === 400, '候选项少于两个被请求校验拒绝');

  const unknownCategory = await request('/polls', mom.token, 'POST', {
    title: '未知分类测试',
    category: '不存在的分类',
    options: [{ label: '甲' }, { label: '乙' }],
  });
  assert(unknownCategory.status === 400, '未知投票分类被请求校验拒绝');

  const multiplePoll = await request('/polls', mom.token, 'POST', {
    title: '周末家庭活动测试',
    description: '选出这周最想参加的活动',
    category: 'activity',
    voteMode: 'multiple',
    maxChoices: 2,
    closesAt: '2199-12-31T12:00:00.000Z',
    options: [
      { label: '逛公园' },
      { label: '看展览' },
      { label: '在家做饭' },
    ],
  });
  assert(
    multiplePoll.status === 201 &&
      multiplePoll.data.options.length === 3 &&
      multiplePoll.data.voteMode === 'multiple' &&
      multiplePoll.data.maxChoices === 2,
    '普通成员可以创建带截止时间的多选投票',
  );
  createdPollIds.push(multiplePoll.data.id);

  const dadNotifications = await request('/notifications', dad.token);
  assert(
    dadNotifications.data.some(
      (item) =>
        item.module === 'poll' &&
        item.type === 'poll_created' &&
        item.sourceId === multiplePoll.data.id,
    ),
    '其他家庭成员收到新投票通知',
  );

  console.log('2. 多选改票、撤票与透明结果');
  const optionIds = multiplePoll.data.options.map((option) => option.id);
  const dadVotesTwo = await request(
    `/polls/${multiplePoll.data.id}/votes`,
    dad.token,
    'POST',
    { optionIds: optionIds.slice(0, 2) },
  );
  assert(
    dadVotesTwo.status === 201 &&
      dadVotesTwo.data.selectedOptionIds.length === 2 &&
      dadVotesTwo.data.totalVoters === 1 &&
      dadVotesTwo.data.totalVotes === 2,
    '多选投票一次提交整组选择并统计一个参与成员',
  );

  const tooMany = await request(
    `/polls/${multiplePoll.data.id}/votes`,
    dad.token,
    'POST',
    { optionIds },
  );
  assert(tooMany.status === 400, '超过最多选择数会被拒绝');

  // voteBody 的去重约束，原先是 VoteDto 的 @ArrayUnique()
  const duplicateVote = await request(
    `/polls/${multiplePoll.data.id}/votes`,
    dad.token,
    'POST',
    { optionIds: [optionIds[0], optionIds[0]] },
  );
  assert(duplicateVote.status === 400, '同一选项重复提交被请求校验拒绝');

  const dadChangesVote = await request(
    `/polls/${multiplePoll.data.id}/votes`,
    dad.token,
    'POST',
    { optionIds: [optionIds[2]] },
  );
  assert(
    dadChangesVote.status === 201 &&
      dadChangesVote.data.totalVotes === 1 &&
      dadChangesVote.data.selectedOptionIds[0] === optionIds[2],
    '再次提交会替换旧选择而不是累计重复选票',
  );

  const momVotes = await request(
    `/polls/${multiplePoll.data.id}/votes`,
    mom.token,
    'POST',
    { optionIds: [optionIds[0], optionIds[2]] },
  );
  const sharedResult = momVotes.data.options.find(
    (option) => option.id === optionIds[2],
  );
  assert(
    momVotes.status === 201 &&
      momVotes.data.totalVoters === 2 &&
      sharedResult.voteCount === 2 &&
      sharedResult.percentage === 100 &&
      sharedResult.voters.length === 2,
    '家庭内透明展示票数、比例和参与成员',
  );

  const idempotentRuleUpdate = await request(
    `/polls/${multiplePoll.data.id}`,
    mom.token,
    'PATCH',
    {
      description: '重复提交规则时仍可更新说明',
      voteMode: 'multiple',
      maxChoices: 2,
      options: [
        { label: '逛公园' },
        { label: '看展览' },
        { label: '在家做饭' },
      ],
    },
  );
  const lockedRules = await request(
    `/polls/${multiplePoll.data.id}`,
    mom.token,
    'PATCH',
    { options: [{ label: '新选项一' }, { label: '新选项二' }] },
  );
  const editableMetadata = await request(
    `/polls/${multiplePoll.data.id}`,
    mom.token,
    'PATCH',
    { title: '周末家庭活动测试（已更新）' },
  );
  assert(
    idempotentRuleUpdate.status === 200 &&
      idempotentRuleUpdate.data.description === '重复提交规则时仍可更新说明' &&
      idempotentRuleUpdate.data.totalVotes === 3 &&
      idempotentRuleUpdate.data.options.every(
        (option, index) => option.id === optionIds[index],
      ) &&
    lockedRules.status === 409 &&
      editableMetadata.status === 200 &&
      editableMetadata.data.title.endsWith('（已更新）'),
    '已有选票后允许幂等提交并锁定实际规则变更',
  );

  console.log('3. 创建者、管理员、结束和重新开启');
  const ownerPoll = await request('/polls', dad.token, 'POST', {
    title: '管理员投票权限测试',
    category: 'general',
    voteMode: 'single',
    options: [{ label: '方案一' }, { label: '方案二' }],
  });
  assert(ownerPoll.status === 201, '家庭管理员可以发起单选投票');
  createdPollIds.push(ownerPoll.data.id);

  const forbiddenEdit = await request(
    `/polls/${ownerPoll.data.id}`,
    mom.token,
    'PATCH',
    { title: '不应修改' },
  );
  const momSingleVote = await request(
    `/polls/${ownerPoll.data.id}/votes`,
    mom.token,
    'POST',
    { optionIds: [ownerPoll.data.options[0].id] },
  );
  assert(
    forbiddenEdit.status === 403 && momSingleVote.status === 201,
    '普通成员不能管理他人投票但可以参与',
  );

  const adminCloses = await request(
    `/polls/${multiplePoll.data.id}/close`,
    dad.token,
    'POST',
  );
  const voteAfterClose = await request(
    `/polls/${multiplePoll.data.id}/votes`,
    mom.token,
    'POST',
    { optionIds: [] },
  );
  const adminReopens = await request(
    `/polls/${multiplePoll.data.id}/reopen`,
    dad.token,
    'POST',
  );
  const withdraw = await request(
    `/polls/${multiplePoll.data.id}/votes`,
    mom.token,
    'POST',
    { optionIds: [] },
  );
  assert(
    adminCloses.status === 201 &&
      adminCloses.data.status === 'closed' &&
      voteAfterClose.status === 409 &&
      adminReopens.status === 201 &&
      adminReopens.data.status === 'open' &&
      withdraw.status === 201 &&
      withdraw.data.selectedOptionIds.length === 0,
    '管理员可结束和重新开启投票，结束期间禁止改票，成员可撤票',
  );

  const archived = await request(
    `/polls/${multiplePoll.data.id}`,
    mom.token,
    'DELETE',
  );
  const afterArchive = await request('/polls?status=all', mom.token);
  assert(
    archived.status === 200 &&
      archived.data.archived === true &&
      !afterArchive.data.some((poll) => poll.id === multiplePoll.data.id),
    '创建者可软删除投票且列表不再展示',
  );

  console.log('\n家庭投票测试全部通过');
} finally {
  for (const pollId of createdPollIds) {
    await request(`/polls/${pollId}`, dad.token, 'DELETE');
  }
}
