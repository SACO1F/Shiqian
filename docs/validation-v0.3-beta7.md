# 拾签 v0.3.0-beta.7 验收记录

日期：2026-10-10。Windows 开发电脑；实际生产 Tauri/WebView2；独立合成资料库 `qa/beta7-ui/library`，37 个合成 PNG。数据库 schema 2，用户资料库未参与测试。

## 本轮验证

| 场景 | 结果 | 证据 |
|---|---|---|
| 取消选择 | 瀑布流和列表中，单个文件重复普通点击取消；换选另一文件、Ctrl 增减选、Shift 范围选择均通过 | [工具栏回归](evidence/beta7-toolbar.log) |
| 图标操作与悬浮提示 | 收藏、导出资料包、移除按钮不含可见文字；32px 宽、16px 图标居中；浅深色提示正确，边缘不越界，ARIA 关联有效 | [工具栏回归](evidence/beta7-toolbar.log) |
| 功能保留 | 收藏与取消收藏实际写入数据库；导出按钮打开所选 1 文件的资料包对话框；移除按钮打开确认，取消后文件记录保留 | [工具栏回归](evidence/beta7-toolbar.log) |
| 布局切换提示 | 列表与瀑布流两个图标悬浮显示对应文字；键盘焦点显示提示，Escape 收起，减少动态效果模式关闭动画 | [工具栏回归](evidence/beta7-toolbar.log) |
| 顶部与标题 | 按钮从左至右为撤销、刷新、侧栏切换；冗余工作台文字移除；原生主窗口实际标题为拾签 | [工具栏回归](evidence/beta7-toolbar.log)、[原生标题](evidence/beta7-native-title.log) |
| 详情稳定性 | 连续 12 轮详情开关，滚动位置始终为 1800 | [界面回归](evidence/beta7-ui-regression.log) |
| 既有标签选择与下拉样式 | 已用标签排除；16 个未用候选完整展示；Enter 不重复添加；多文件候选保留部分缺失标签；浅深色四处选择器样式一致且密度保存 | [界面回归](evidence/beta7-ui-regression.log) |
| 构建与版本门禁 | TypeScript/Vite、Tauri release、NSIS 构建通过；版本门禁 3 项通过 | [生产构建](evidence/beta7-build.log)、[安装包构建](evidence/beta7-bundle.log)、[版本门禁](evidence/beta7-release-gates.log) |

两套界面测试均无未捕获页面错误。源码包完整性、六处源码版本、两个原生程序版本与五个交付文件 SHA-256 由打包脚本验证，记录在 `docs/evidence/beta7-delivery.log`。

## 参考与实现

参考 [React Bits Warm Tooltip](https://reactbits.dev/c/micro/warm-tooltip) 的圆角浮层、淡入和缩放效果。本项目通过现有 React/CSS 独立实现，沿用拾签主题色，无新增动画依赖；没有完整复刻其跨按钮共享提示、触摸长按等可选行为。

第 3 项经用户澄清为列表布局切换图标的文字提示，列表行内文件信息和标签悬浮展示未改动。窗口标题简化为拾签，保留系统标题栏和原生窗口控制。

## 测试调整

- 首次连接测试端口时 WebView2 尚未就绪，等待启动后重跑；见 `evidence/beta7-startup-initial.log`。
- 测试初始化误用了不受支持的 AI 设置键，移除；独立资料库无 AI 服务配置，见 `evidence/beta7-fixture-initial.log`。
- 首次收藏后，测试鼠标仍在相同按钮上，未重新触发进入事件；测试改为明确离开后重新悬浮，并在重跑时恢复合成文件的收藏状态，见 `evidence/beta7-hover-initial.log`。
- 最终构建前提高图标按钮样式优先级，避免历史批量按钮间距规则覆盖居中布局；最终验证宽度、内边距和图标尺寸。

## 验证边界

本轮只调整前端交互及原生窗口标题，未修改 Rust 数据处理逻辑；未重复核心测试，上一轮 94 项通过的记录保留在 `docs/evidence/beta6-core.log`。本轮未执行安装器覆盖安装、卸载、混合 DPI 或全天运行测试。导出验证到打开正确范围的对话框，未再次执行完整资料包交接流程。

使用与升级见 [Beta.7 指南](beta-v0.3-beta7.md)。
