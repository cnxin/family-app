# 信息架构收敛 · 结构示意稿

配合 `docs/ia-plan.md` 阅读。四个文件都是**自包含的静态 HTML**，直接读源码或用浏览器打开都行。

| 文件 | 画面 | 对应任务 |
| --- | --- | --- |
| `today-mobile.html` | 手机 · 今天（390 宽）：搜索条、今晚吃什么、我的任务、需要留意、底部 4 个 tab | F1、F5 |
| `home-mobile.html` | 手机 · 家里：我钉住的 / 家里在用的 / 还可以开启 / 家庭设置 | F2、F4、F7 |
| `search-mobile.html` | 手机 · 搜索与动作：动作 / 页面 / 交给小管家 | F6 |
| `today-desktop.html` | 桌面 · 今天（1280 宽）：平铺侧栏 + 两栏主区 | F1、F5 |

**只看这些**：每屏有哪些区块、区块的先后顺序、每个区块里放什么信息、导航有几项、各自叫什么。

**不要照搬这些**：配色、字体、圆角、间距、内联样式的写法、示例数据。实现一律用 `apps/web` 现有的
`Page / Panel / Card / Button / Dialog` 等组件和 Tailwind token，动效遵守 `.claude/skills/apple-design`，
暗色模式必须能看。示意稿没画暗色，不代表不用做。

示意稿与 `ia-plan.md` 的文字有出入时，**以 `ia-plan.md` 为准**。
