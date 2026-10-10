# 拾签 v0.3.0-beta.9 验收记录

日期：2026-10-10。Windows 开发电脑；真实生产 Tauri/WebView2；独立合成资料库 `qa/beta9-ui/library`。数据库 schema 2，用户资料库未参与测试。

## 本轮验证

| 场景 | 结果 | 证据 |
|---|---|---|
| 标题栏位置 | 原生主窗口 decorations 为 false；仅一个自定义标题栏，位置 y=0、高 32px；左侧三个按钮在顶栏最左侧；下方无第二条工具栏 | [标题栏回归](evidence/beta9-titlebar.log)、[工具栏回归](evidence/beta9-toolbar.log) |
| 最大化／还原 | 点击最大化实际进入原生最大化，图标与名称更新为还原；还原后恢复；双击事件处理也切换原生最大化状态 | [标题栏回归](evidence/beta9-titlebar.log) |
| 最小化 | 点击后原生 is_minimized 为 true；main.show 恢复后为 false | [标题栏回归](evidence/beta9-titlebar.log) |
| 关闭路径 | 浮窗打开时，标题栏关闭按钮触发已有退出处理、隐藏主窗口；浮窗保持可用，其打开工作台按钮重新显示主窗口 | [标题栏回归](evidence/beta9-titlebar.log) |
| 缩放区域 | 普通窗口显示八个边缘／角落区域，最大化时隐藏，还原后恢复；main 专用能力允许调用原生缩放拖动 | [标题栏回归](evidence/beta9-titlebar.log) |
| 既有工具栏与选择 | 排序和操作常驻；全选／取消、重复点击、Ctrl/Shift 选择；960/1360px 控件不越界；浅深色提示、收藏状态、导出和移除对话框、减少动态效果通过 | [工具栏回归](evidence/beta9-toolbar.log) |
| 详情与标签、下拉回归 | 12 轮详情开关位置均为 1800；标签候选排除和完整展示、去重、部分缺失候选通过；浅深色四处下拉样式一致，密度保存 | [界面回归](evidence/beta9-ui-regression.log) |
| 构建 | TypeScript/Vite、Tauri release、NSIS 构建通过；版本门禁 3 项通过 | [生产构建](evidence/beta9-build.log)、[安装包构建](evidence/beta9-bundle.log)、[版本门禁](evidence/beta9-release-gates.log) |

上述回归均无未捕获页面错误。交付脚本验证源码六处版本、两个原生程序版本、源码 ZIP 完整性和五个资产 SHA-256；记录在 `docs/evidence/beta9-delivery.log`。

## 实现

主窗口关闭原生装饰，原生窗口身份与任务栏名称仍为拾签。左侧操作进入自定义顶栏，右侧窗口按钮通过已有 Tauri 窗口 API 执行；窗口控制能力限定 main，浮窗配置不变。空白区域调用原生 startDragging，双击切换最大化。关闭使用 close 请求，继续进入 App 既有备注、设置保存和后台任务检查，不直接 destroy。

八个透明边缘区域调用原生 startResizeDragging，最大化状态通过窗口尺寸事件和 isMaximized 同步，最大化时不显示缩放区域。

## 验证边界

原生最小化、最大化、还原、主窗口隐藏及通过浮窗打开均实际执行。双击测试注入 DOM dblclick 事件验证处理到原生状态的链路；未用物理鼠标复测空白区域拖动、双击与边缘缩放，也未进行混合 DPI、多屏吸附验收。尺寸适配为 WebView 视口测试。

本轮未修改 Rust 数据处理逻辑，核心测试沿用 Beta.6 的 94 项通过记录（`docs/evidence/beta6-core.log`）；未重复完整退出压力、资料包交接、覆盖安装或卸载测试。

使用与升级见 [Beta.9 指南](beta-v0.3-beta9.md)。
