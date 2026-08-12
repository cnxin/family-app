const NAV = {
  a: [
    ['home', 'house', '今天'],
    ['calendar', 'calendar-days', '安排'],
    ['assistant', 'sparkles', '管家'],
    ['notifications', 'bell', '消息'],
    ['profile', 'user-round', '我的'],
  ],
  b: [
    ['home', 'layout-dashboard', '总览'],
    ['calendar', 'calendar-days', '日历'],
    ['assistant', 'terminal', '指令'],
    ['notifications', 'bell', '通知'],
    ['profile', 'circle-user-round', '账户'],
  ],
};

const phoneState = new Map();

function icon(name, className = '') {
  return `<i data-lucide="${name}"${className ? ` class="${className}"` : ''}></i>`;
}

function homeA() {
  return `
    <div class="screen home-screen">
      <header class="top-row">
        <div>
          <p class="date-line">8月11日 · 星期二</p>
          <h3>晚上好，爸爸</h3>
        </div>
        <button class="icon-button" data-action="quick-add" aria-label="快速新增">${icon('plus')}</button>
      </header>

      <button class="assistant-entry" data-screen="assistant">
        <span class="assistant-mark">${icon('sparkles')}</span>
        <span class="detail-copy"><strong>问问小管家</strong><span>今天家里有什么需要留意？</span></span>
        ${icon('chevron-right', 'chevron')}
      </button>

      <div class="section-heading"><h4>今天</h4><button class="text-action" data-screen="calendar">查看日历</button></div>
      <div class="agenda-list">
        <button class="agenda-row" data-screen="calendar">
          <span class="agenda-time">18:30</span>
          <span class="agenda-copy"><strong>准备家庭晚餐</strong><span>番茄鸡蛋、清炒时蔬</span></span>
          <span class="agenda-state">3 人</span>
        </button>
        <button class="agenda-row" data-action="toast" data-toast-text="任务已标记为完成">
          <span class="agenda-time">20:00</span>
          <span class="agenda-copy"><strong>给净化器换滤芯</strong><span>客厅 · 已准备耗材</span></span>
          <span class="agenda-state warn">今天</span>
        </button>
      </div>

      <div class="section-heading"><h4>家庭焦点</h4><button class="text-action" data-action="toast" data-toast-text="已打开全部动态">全部</button></div>
      <div class="focus-grid">
        <button class="focus-item with-image" data-action="toast" data-toast-text="已打开今晚菜单">
          <img src="https://images.unsplash.com/photo-1547592180-85f173990554?auto=format&fit=crop&w=520&q=82" alt="今晚家庭晚餐" />
          <span class="focus-copy"><strong>今晚吃什么</strong><span>三菜一汤 · 18:30</span></span>
        </button>
        <button class="focus-item" data-screen="asset">
          <span class="row-icon">${icon('package-check')}</span>
          <p class="focus-kpi">28 天</p>
          <span class="focus-copy"><strong>滤芯保养</strong><span>客厅净化器即将到期</span></span>
        </button>
      </div>

      <div class="section-heading"><h4>家里刚刚</h4></div>
      <div class="activity-line"><span class="avatar">妈</span><div><p>妈妈完成了「取快递」</p><time>18:04</time></div></div>
      <div class="activity-line"><span class="avatar">奶</span><div><p>奶奶为周六聚餐投了赞成票</p><time>17:26</time></div></div>
    </div>`;
}

function homeB() {
  return `
    <div class="screen home-screen">
      <header class="control-header">
        <p class="control-label">家庭控制台 / 8月11日</p>
        <div class="control-title-row"><h3 class="control-title">今日总览</h3><span class="control-date">星期二 · 19:41</span></div>
        <button class="command-bar" data-screen="assistant">${icon('terminal')}<span>查询、记录或协调家庭事务</span>${icon('arrow-up-right')}</button>
      </header>

      <div class="status-grid" aria-label="今日家庭状态">
        <div class="status-cell"><strong>03</strong><span>待办事项</span></div>
        <div class="status-cell"><strong>02</strong><span>日程安排</span></div>
        <div class="status-cell"><strong>01</strong><span>需要关注</span></div>
      </div>

      <div class="section-heading"><h4>执行队列</h4><button class="text-action" data-action="quick-add">新增</button></div>
      <div class="queue-list">
        <button class="queue-row" data-action="toast" data-toast-text="任务详情已打开">
          <span class="queue-code">18:30</span><span class="queue-priority"></span>
          <span class="queue-copy"><strong>家庭晚餐准备</strong><span>3 人 · 厨房 · 菜单已确认</span></span>
          <span class="status-badge">进行中</span>
        </button>
        <button class="queue-row" data-screen="asset">
          <span class="queue-code">20:00</span><span class="queue-priority warn"></span>
          <span class="queue-copy"><strong>更换净化器滤芯</strong><span>客厅 · 耗材库存 1</span></span>
          <span class="status-badge warn">到期</span>
        </button>
        <button class="queue-row" data-screen="calendar">
          <span class="queue-code">周六</span><span class="queue-priority"></span>
          <span class="queue-copy"><strong>爸妈来家里吃饭</strong><span>5 人 · 需要确认采购</span></span>
          <span class="status-badge">计划</span>
        </button>
      </div>

      <div class="section-heading"><h4>资产状态</h4><button class="text-action" data-screen="asset">查看</button></div>
      <div class="asset-list">
        <button class="asset-row" data-screen="asset">
          <span class="asset-thumb">${icon('wind')}</span>
          <span class="asset-copy"><strong>客厅空气净化器</strong><span>在保 · 下次维保 9月8日</span></span>
          ${icon('chevron-right', 'chevron')}
        </button>
      </div>

      <div class="section-heading"><h4>最新活动</h4></div>
      <div class="control-log">
        <div class="log-entry"><span class="log-time">18:04 / 妈妈</span><p>完成任务「取快递」</p></div>
        <div class="log-entry"><span class="log-time">17:26 / 奶奶</span><p>参与周六家庭聚餐投票</p></div>
      </div>
    </div>`;
}

function assistantA() {
  return `
    <div class="screen has-composer assistant-screen">
      <header class="compact-top-row">
        <button class="icon-button" data-screen="home" aria-label="返回今天">${icon('chevron-left')}</button>
        <h3 class="screen-title">问问小管家</h3>
        <button class="icon-button" data-action="new-chat" aria-label="开始新对话">${icon('square-pen')}</button>
      </header>
      <div class="context-strip">${icon('sparkles')}<span>正在参考：家庭首页</span></div>
      <div class="message user"><div class="message-bubble"><p>今晚家里有什么安排，需要准备什么？</p></div></div>
      <div class="message assistant">
        <span class="assistant-mark">${icon('sparkles')}</span>
        <div class="message-bubble"><p>今晚有两件事：18:30 准备家庭晚餐，20:00 给客厅净化器更换滤芯。晚餐食材已经齐全，滤芯库存还有 1 个。</p></div>
      </div>
      <div class="result-panel">
        <div class="result-head"><span class="result-icon">${icon('calendar-check')}</span><div class="result-copy"><strong>今晚安排</strong><span>来自家庭实时数据</span></div></div>
        <div class="result-row"><span class="result-time">18:30</span><span class="result-copy"><strong>准备家庭晚餐</strong><span>番茄鸡蛋、清炒时蔬</span></span></div>
        <div class="result-row"><span class="result-time">20:00</span><span class="result-copy"><strong>更换净化器滤芯</strong><span>客厅 · 耗材已准备</span></span></div>
      </div>
      <div data-chat-tail></div>
      <div class="composer-wrap"><form class="composer" data-chat-form><input aria-label="发送给小管家" placeholder="问问家里的事" /><button class="send-button" aria-label="发送">${icon('arrow-up')}</button></form></div>
    </div>`;
}

function assistantB() {
  return `
    <div class="screen has-composer assistant-screen">
      <header class="compact-top-row">
        <button class="icon-button" data-screen="home" aria-label="返回总览">${icon('arrow-left')}</button>
        <div class="detail-copy"><p class="eyebrow">FAMILY AGENT</p><h3 class="screen-title">家庭指令</h3></div>
        <button class="icon-button" data-action="new-chat" aria-label="清空对话">${icon('rotate-ccw')}</button>
      </header>
      <div class="context-strip">${icon('database')}<span>CONTEXT / 家庭总览 / 实时</span></div>
      <div class="control-log">
        <div class="log-entry"><span class="log-time">19:41:02 / YOU</span><p>今晚家里有什么安排，需要准备什么？</p></div>
        <div class="log-entry"><span class="log-time">19:41:04 / AGENT</span><div class="tool-strip"><span>get_family_schedule</span><span>get_inventory_summary</span></div><p>今晚共有 2 项安排。晚餐食材已齐，净化器滤芯库存为 1。</p></div>
      </div>
      <div class="control-panel">
        <div class="result-head"><span class="result-icon">${icon('list-checks')}</span><div class="result-copy"><strong>执行摘要</strong><span>2 项 · 数据已核验</span></div></div>
        <div class="result-row"><span class="result-time">01</span><span class="result-copy"><strong>18:30 家庭晚餐</strong><span>无需额外采购</span></span></div>
        <div class="result-row"><span class="result-time">02</span><span class="result-copy"><strong>20:00 更换滤芯</strong><span>耗材库存 1</span></span></div>
      </div>
      <div data-chat-tail></div>
      <div class="composer-wrap"><form class="composer" data-chat-form><input aria-label="输入家庭指令" placeholder="输入家庭指令" /><button class="send-button" aria-label="执行">${icon('corner-down-left')}</button></form></div>
    </div>`;
}

function assetA() {
  return `
    <div class="screen asset-screen">
      <header class="detail-header">
        <div class="compact-top-row">
          <button class="icon-button" data-screen="home" aria-label="返回今天">${icon('chevron-left')}</button>
          <button class="icon-button" data-action="toast" data-toast-text="已打开资产管理" aria-label="编辑资产">${icon('pencil')}</button>
        </div>
        <p class="eyebrow">家庭资产 · 客厅</p>
        <h3 class="detail-title">客厅空气净化器</h3>
        <p class="detail-subtitle">家电 · 使用中 · 靠窗设备区</p>
      </header>
      <section class="warranty-panel">
        <div class="identity-row"><span class="assistant-mark">${icon('shield-check')}</span><div><h4>仍在保修期内</h4><p>还剩 268 天</p></div></div>
        <div class="warranty-date"><span>保修到期</span><strong>2027年5月6日</strong></div>
      </section>
      <button class="assistant-entry ask-asset" data-screen="assistant"><span class="assistant-mark">${icon('sparkles')}</span><span class="detail-copy"><strong>问小管家这个资产</strong><span>保修、维保和耗材都可以问</span></span>${icon('chevron-right', 'chevron')}</button>
      <div class="section-heading"><h4>资产信息</h4></div>
      <div class="info-table">
        <div class="info-row"><span>品牌与型号</span><strong>Blueair HealthProtect 7470i</strong></div>
        <div class="info-row"><span>购入日期</span><strong>2025年5月6日</strong></div>
        <div class="info-row"><span>序列号</span><strong>BA-7470-2025-0842</strong></div>
      </div>
      <div class="section-heading"><h4>维保计划</h4><button class="text-action" data-action="toast" data-toast-text="维保计划已打开">管理</button></div>
      <div class="plain-list"><button class="list-row" data-action="toast" data-toast-text="维保详情已打开"><span class="row-icon">${icon('refresh-cw')}</span><span class="list-copy"><strong>更换复合滤芯</strong><span>下次：9月8日 · 每 180 天</span></span><span class="status-badge warn">28 天</span></button></div>
    </div>`;
}

function assetB() {
  return `
    <div class="screen asset-screen">
      <header class="compact-top-row"><button class="icon-button" data-screen="home" aria-label="返回总览">${icon('arrow-left')}</button><p class="control-label">ASSET / 07</p><button class="icon-button" data-action="toast" data-toast-text="已打开资产编辑" aria-label="编辑资产">${icon('pencil')}</button></header>
      <h3 class="detail-title">客厅空气净化器</h3>
      <div class="status-row"><span class="status-badge">使用中</span><span class="status-badge">家电</span><span class="status-badge warn">28 天后维保</span></div>
      <div class="warranty-track">
        <div class="section-heading"><h4>保修进度</h4><span class="control-label">剩余 268 天</span></div>
        <div class="track-line"><span></span></div>
        <div class="track-meta"><span>2025.05.06 购入</span><span>2027.05.06 到期</span></div>
      </div>
      <button class="command-bar ask-asset" data-screen="assistant">${icon('terminal')}<span>查询此资产的保修与维保信息</span>${icon('arrow-up-right')}</button>
      <div class="section-heading"><h4>资产字段</h4><button class="text-action" data-action="toast" data-toast-text="已打开字段管理">编辑</button></div>
      <div class="detail-control-grid">
        <div class="detail-control-cell"><span>位置</span><strong>客厅靠窗设备区</strong></div>
        <div class="detail-control-cell"><span>状态</span><strong>使用中</strong></div>
        <div class="detail-control-cell"><span>品牌</span><strong>Blueair</strong></div>
        <div class="detail-control-cell"><span>型号</span><strong>HealthProtect 7470i</strong></div>
        <div class="detail-control-cell"><span>序列号</span><strong>BA-7470-2025-0842</strong></div>
        <div class="detail-control-cell"><span>资料</span><strong>3 份文档</strong></div>
      </div>
      <div class="section-heading"><h4>维保队列</h4></div>
      <div class="queue-list"><button class="queue-row" data-action="toast" data-toast-text="维保详情已打开"><span class="queue-code">09.08</span><span class="queue-priority warn"></span><span class="queue-copy"><strong>更换复合滤芯</strong><span>周期 180 天 · 耗材库存 1</span></span></button></div>
    </div>`;
}

function calendarScreen(variant) {
  const title = variant === 'a' ? '家庭安排' : '日历队列';
  return `
    <div class="screen">
      <header class="compact-top-row"><div><p class="eyebrow">8月11日 · 星期二</p><h3 class="screen-title">${title}</h3></div><button class="icon-button" data-action="quick-add" aria-label="新增日程">${icon('plus')}</button></header>
      <div class="schedule-day"><div class="schedule-date"><strong>11</strong><span>今天 · 2 项</span></div><div class="agenda-list"><button class="agenda-row" data-action="toast" data-toast-text="晚餐日程已打开"><span class="agenda-time">18:30</span><span class="agenda-copy"><strong>家庭晚餐</strong><span>厨房 · 3 人</span></span></button><button class="agenda-row" data-screen="asset"><span class="agenda-time">20:00</span><span class="agenda-copy"><strong>更换净化器滤芯</strong><span>客厅 · 耗材已准备</span></span></button></div></div>
      <div class="schedule-day"><div class="schedule-date"><strong>15</strong><span>周六 · 1 项</span></div><div class="agenda-list"><button class="agenda-row" data-action="toast" data-toast-text="聚餐提案已打开"><span class="agenda-time">17:30</span><span class="agenda-copy"><strong>爸妈来家里吃饭</strong><span>5 人 · 菜单待确认</span></span><span class="agenda-state warn">提案</span></button></div></div>
    </div>`;
}

function notificationsScreen(variant) {
  return `
    <div class="screen">
      <header class="compact-top-row"><div><p class="eyebrow">${variant === 'a' ? '家庭消息' : 'NOTIFICATION QUEUE'}</p><h3 class="screen-title">消息</h3></div><button class="icon-button" data-action="toast" data-toast-text="全部消息已读" aria-label="全部标记已读">${icon('check-check')}</button></header>
      <div class="section-heading"><h4>今天</h4></div>
      <div class="plain-list">
        <button class="list-row" data-screen="asset"><span class="notice-mark warn"></span><span class="list-copy"><strong>净化器将在 28 天后维保</strong><span>耗材库存充足 · 18:02</span></span>${icon('chevron-right', 'chevron')}</button>
        <button class="list-row" data-action="toast" data-toast-text="投票详情已打开"><span class="notice-mark"></span><span class="list-copy"><strong>周六聚餐投票有新进展</strong><span>4 人已参与 · 17:26</span></span>${icon('chevron-right', 'chevron')}</button>
      </div>
    </div>`;
}

function profileScreen(variant) {
  return `
    <div class="screen">
      <header class="compact-top-row"><div><p class="eyebrow">${variant === 'a' ? '家庭成员' : 'ACCOUNT / OWNER'}</p><h3 class="screen-title">我的</h3></div></header>
      <div class="profile-hero"><div class="profile-avatar">爸</div><div><h3>爸爸</h3><p>家庭管理员 · 深圳家庭</p></div></div>
      <div class="section-heading"><h4>偏好</h4></div>
      <div class="profile-list">
        <button class="profile-row" data-action="theme"><span class="row-icon">${icon('moon')}</span><span class="profile-copy"><strong>深色外观</strong><span>跟随你的使用环境</span></span><span class="switch" aria-hidden="true"></span></button>
        <button class="profile-row" data-action="toast" data-toast-text="小管家记忆已打开"><span class="row-icon">${icon('brain')}</span><span class="profile-copy"><strong>小管家记忆</strong><span>17 条已确认偏好</span></span>${icon('chevron-right', 'chevron')}</button>
        <button class="profile-row" data-action="toast" data-toast-text="家庭设置已打开"><span class="row-icon">${icon('settings-2')}</span><span class="profile-copy"><strong>家庭设置</strong><span>成员、通知与服务</span></span>${icon('chevron-right', 'chevron')}</button>
      </div>
    </div>`;
}

function screenTemplate(variant, screen) {
  if (screen === 'home') return variant === 'a' ? homeA() : homeB();
  if (screen === 'assistant') return variant === 'a' ? assistantA() : assistantB();
  if (screen === 'asset') return variant === 'a' ? assetA() : assetB();
  if (screen === 'calendar') return calendarScreen(variant);
  if (screen === 'notifications') return notificationsScreen(variant);
  return profileScreen(variant);
}

function navTemplate(variant, active) {
  return NAV[variant].map(([screen, iconName, label]) => `
    <button class="nav-item${active === screen || (active === 'asset' && screen === 'home') ? ' active' : ''}" data-screen="${screen}" aria-label="${label}" aria-current="${active === screen ? 'page' : 'false'}">
      ${icon(iconName)}<span>${label}</span>
    </button>`).join('');
}

function quickAddTemplate(variant) {
  return `<div class="sheet" role="dialog" aria-modal="true" aria-label="快速新增">
    <div class="sheet-grabber" aria-hidden="true"></div>
    <div class="sheet-head"><h3>${variant === 'a' ? '想记录什么？' : '新建家庭记录'}</h3><button class="icon-button" data-action="close-sheet" aria-label="关闭">${icon('x')}</button></div>
    <div class="sheet-actions">
      <button class="sheet-action" data-action="sheet-choice" data-toast-text="任务已创建">${icon('list-checks')}<strong>任务</strong></button>
      <button class="sheet-action" data-action="sheet-choice" data-toast-text="日程已创建">${icon('calendar-plus')}<strong>日程</strong></button>
      <button class="sheet-action" data-action="sheet-choice" data-toast-text="购物项已添加">${icon('shopping-cart')}<strong>购物</strong></button>
      <button class="sheet-action" data-action="sheet-choice" data-toast-text="提醒已创建">${icon('bell-plus')}<strong>提醒</strong></button>
    </div>
  </div>`;
}

function refreshIcons() {
  if (window.lucide) window.lucide.createIcons({ attrs: { 'aria-hidden': 'true' } });
}

function renderPhone(phone) {
  const state = phoneState.get(phone);
  const stage = phone.querySelector('[data-stage]');
  const nav = phone.querySelector('[data-nav]');
  stage.innerHTML = screenTemplate(state.variant, state.screen);
  nav.innerHTML = navTemplate(state.variant, state.screen);
  stage.scrollTop = 0;
  refreshIcons();
}

function showToast(phone, text) {
  const toast = phone.querySelector('[data-toast]');
  toast.textContent = text;
  toast.classList.add('show');
  window.clearTimeout(toast._timer);
  toast._timer = window.setTimeout(() => toast.classList.remove('show'), 1600);
}

function setTheme(phone, dark) {
  phone.dataset.dark = String(dark);
  const trigger = document.querySelector(`[data-phone="${phone.id}"]`);
  if (trigger) trigger.innerHTML = icon(dark ? 'sun' : 'moon');
  refreshIcons();
}

function sendMockMessage(phone, form) {
  const input = form.querySelector('input');
  const value = input.value.trim();
  if (!value) return;
  const tail = phone.querySelector('[data-chat-tail]');
  const variant = phone.dataset.variant;
  tail.innerHTML = variant === 'a'
    ? `<div class="message user"><div class="message-bubble"><p>${escapeHtml(value)}</p></div></div><div class="message assistant"><span class="assistant-mark">${icon('sparkles')}</span><div class="message-bubble"><span class="typing"><i></i><i></i><i></i></span></div></div>`
    : `<div class="control-log"><div class="log-entry"><span class="log-time">NOW / YOU</span><p>${escapeHtml(value)}</p></div><div class="log-entry"><span class="log-time">RUNNING / AGENT</span><div class="typing"><i></i><i></i><i></i></div></div></div>`;
  input.value = '';
  refreshIcons();
  phone.querySelector('[data-stage]').scrollTo({ top: 10000, behavior: 'smooth' });
  window.setTimeout(() => {
    tail.innerHTML = variant === 'a'
      ? `<div class="message user"><div class="message-bubble"><p>${escapeHtml(value)}</p></div></div><div class="message assistant"><span class="assistant-mark">${icon('sparkles')}</span><div class="message-bubble"><p>我会基于家庭实时数据处理这件事。原型里暂不提交真实操作。</p></div></div>`
      : `<div class="control-log"><div class="log-entry"><span class="log-time">NOW / YOU</span><p>${escapeHtml(value)}</p></div><div class="log-entry"><span class="log-time">COMPLETE / AGENT</span><p>已收到指令。原型环境未连接真实家庭数据。</p></div></div>`;
    refreshIcons();
  }, 700);
}

function escapeHtml(value) {
  return value.replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);
}

document.querySelectorAll('.phone').forEach((phone) => {
  const state = { variant: phone.dataset.variant, screen: 'home', dark: false };
  phoneState.set(phone, state);
  renderPhone(phone);

  phone.addEventListener('click', (event) => {
    const target = event.target.closest('button');
    if (!target) return;
    const nextScreen = target.dataset.screen;
    const action = target.dataset.action;
    if (nextScreen) {
      state.screen = nextScreen;
      renderPhone(phone);
      return;
    }
    if (action === 'quick-add') {
      const layer = phone.querySelector('[data-sheet]');
      layer.innerHTML = quickAddTemplate(state.variant);
      layer.classList.add('open');
      layer.setAttribute('aria-hidden', 'false');
      refreshIcons();
      return;
    }
    if (action === 'close-sheet') {
      const layer = phone.querySelector('[data-sheet]');
      layer.classList.remove('open');
      layer.setAttribute('aria-hidden', 'true');
      return;
    }
    if (action === 'sheet-choice') {
      const layer = phone.querySelector('[data-sheet]');
      layer.classList.remove('open');
      layer.setAttribute('aria-hidden', 'true');
      showToast(phone, target.dataset.toastText);
      return;
    }
    if (action === 'theme') {
      state.dark = !state.dark;
      setTheme(phone, state.dark);
      return;
    }
    if (action === 'new-chat') {
      const tail = phone.querySelector('[data-chat-tail]');
      if (tail) tail.innerHTML = '';
      showToast(phone, state.variant === 'a' ? '已开始新对话' : '会话已重置');
      return;
    }
    if (action === 'toast') showToast(phone, target.dataset.toastText || '已打开');
  });

  phone.addEventListener('submit', (event) => {
    const form = event.target.closest('[data-chat-form]');
    if (!form) return;
    event.preventDefault();
    sendMockMessage(phone, form);
  });
});

document.querySelectorAll('.concept-theme').forEach((button) => {
  button.addEventListener('click', () => {
    const phone = document.getElementById(button.dataset.phone);
    const state = phoneState.get(phone);
    state.dark = !state.dark;
    setTheme(phone, state.dark);
  });
});

refreshIcons();
