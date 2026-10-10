# 拾签 v0.3.0-beta.8 验收记录

日期：2026-10-10。Windows 开发电脑，真实生产 Tauri/WebView2，独立合成资料库 `qa/beta8-ui/library`，37 个合成 PNG。数据库 schema 2；用户资料库未参与测试。

## 本轮验证

| 场景 | 结果 | 证据 |
|---|---|---|
| 排序与文件操作常驻 | 未选与全选状态下均显示排序、方向及操作区；无选择时文件操作禁用，全选后可用，清空后重新禁用 | [工具栏回归](evidence/beta8-toolbar.log) |
| 全选／取消 | 全选当前 37 个结果后全选高亮；取消后清空状态高亮；两个按钮始终可见，不再相互替换 | [工具栏回归](evidence/beta8-toolbar.log) |
| 顶栏位置 | 顶栏左上位置为窗口内容区 0,0；首按钮在 20px 以内；撤销、刷新、侧栏依次排列；侧栏收起再展开，按钮横坐标不变 | [工具栏回归](evidence/beta8-toolbar.log) |
| 窄窗口 | 960px 与 1360px 视口宽度下排序、方向、操作区及选择按钮均在视口内 | [工具栏回归](evidence/beta8-toolbar.log) |
| 既有选择和提示 | 两种布局重复点击取消、Ctrl 增减、Shift 连选通过；五个图标浅深色提示、范围避让、ARIA、键盘焦点、Escape 和减少动态效果均通过 | [工具栏回归](evidence/beta8-toolbar.log) |
| 文件操作 | 收藏及取消实际写入数据库；导出打开所选文件范围对话框；移除打开确认并可取消，保留记录 | [工具栏回归](evidence/beta8-toolbar.log) |
| 详情和标签回归 | 12 轮详情切换滚动位置全部保持 1800；已用标签排除、16 个未用标签完整、重复标签防护和部分缺失候选通过 | [界面回归](evidence/beta8-ui-regression.log) |
| 下拉样式 | 浅深色四处选择器基本样式一致，密度保存 | [界面回归](evidence/beta8-ui-regression.log) |
| 构建与门禁 | TypeScript/Vite、Tauri release、NSIS 构建通过，版本门禁 3 项通过 | [生产构建](evidence/beta8-build.log)、[安装包构建](evidence/beta8-bundle.log)、[版本门禁](evidence/beta8-release-gates.log) |

两套界面测试均无未捕获页面错误。打包脚本校验六处源码版本、两个原生程序版本、源码 ZIP 完整性及五个交付文件 SHA-256，记录在 `docs/evidence/beta8-delivery.log`。

## 设计与实现

参考 [React Bits Jelly Radio](https://reactbits.dev/c/micro/jelly-radio) 的胶囊外形及弹性扩张／回弹，用现有 CSS 独立实现，不增加动画依赖，不完整复刻其邻近选项挤开等可选行为。全选和取消仍是按钮操作，状态来自实际选择；部分选中时不显示全选状态。减少动态效果模式关闭动画。

顶栏采用 Codex 风格的紧凑、低对比度图标排列，固定到跨越侧栏与工作区的全宽顶栏；保留拾签主题、窗口原生标题栏和系统控制。

## 验证边界

本轮改变前端布局和按钮样式，未改 Rust 数据处理。核心测试沿用 Beta.6 的 94 项通过记录（`docs/evidence/beta6-core.log`），本轮未重复核心测试。未进行覆盖安装、卸载、混合 DPI 或全天运行测试；960/1360px 是 WebView 视口尺寸测试。导出验证到正确范围的对话框，未重复完整资料包交接。

使用与升级见 [Beta.8 指南](beta-v0.3-beta8.md)。
