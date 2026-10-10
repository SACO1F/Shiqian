# 拾签 v0.3.0-beta.4 验收记录

日期：2026-10-10。Windows 当前开发电脑，生产 Tauri 程序＋真实 WebView2，独立合成资料库 `qa/beta4-ui/library`。数据库 schema 2。

## 本轮验证

| 场景 | 结果 | 证据 |
|---|---|---|
| 旧 Beta.3 对照复现 | 18 个标签只显示 7 项且包含已应用项；详情面板 8 轮切换，滚动位置从 1800 变为 1560，过程中有上下波动 | [旧版对照](evidence/beta4-baseline.log) |
| 详情标签候选 | 已应用标签不出现在候选；全部 16 个未应用项可选，最末项可滚动到并添加 | [界面回归](evidence/beta4-ui.log) |
| 重复提交与批量标注 | 输入已有标签按 Enter 不产生重复关联；部分选中文件缺少的标签仍可补齐 | [界面回归](evidence/beta4-ui.log) |
| 瀑布流滚动 | 80 张不同纵横比合成图片，滚动位置 1800，12 轮完整开关详情面板后每轮均为 1800 | [界面回归](evidence/beta4-ui.log) |
| 统一选择器 | 浅色、深色下，文件排序、状态筛选、标签匹配方式、密度选择器的圆角、内边距、字号、背景和高度一致，密度可保存 | [界面回归](evidence/beta4-ui.log) |
| 浮窗首次创建 | 隐藏创建后恢复位置；有效位置和 340×460 客户区尺寸准确，无效显示器坐标校正到工作区 | [原生窗口验证](evidence/beta4-window-initial.log) |
| 实际进程重启 | 恢复浮窗位置、展开尺寸与置顶选择 | [重启验证](evidence/beta4-window-reopen.log) |
| 现有浮窗操作 | 主题、置顶、原生大小、键盘大小、折叠/展开、整卡选中、九宫格层级、最小尺寸、销毁重建通过 | [浮窗回归](evidence/beta4-floating-controls.log) |
| 核心测试 | 92 项通过、0 失败、2 个可选压力测试忽略 | [核心测试](evidence/beta4-core.log) |
| 构建与版本门禁 | TypeScript/Vite、Tauri release、NSIS 构建成功；源码版本门禁三项通过；拒绝旧 Beta.3 程序充当新版本 | [版本门禁](evidence/beta4-release-gates.log) |

## 调整记录与验证范围

初次界面回归在主题颜色过渡中读取计算样式，造成背景颜色比较失败；测试改为等待主题过渡完成后读取，正式回归通过。首次重启脚本在 WebView 导航完成前执行，测试增加工作台就绪等待；正式重启验证通过。初始日志保留：`docs/evidence/beta4-ui-initial.log`、`docs/evidence/beta4-window-startup-initial.log`。

浮窗修复改变实际创建/显示顺序，并验证最终原生坐标、客户区尺寸及重启恢复；未做逐帧桌面录屏，因此对特殊显卡、混合 DPI 的首帧视觉仍保留实机验收。安装包已生成；本轮没有在真实用户环境执行安装器或卸载器。此前 Beta.3 的资料包与后台任务验收保持历史记录，本轮没有重复宣称运行其完整交付测试。

升级及使用说明见 [Beta.4 指南](beta-v0.3-beta4.md)。沿用 `docs/beta3-real-device-checklist.md` 做安装、跨设备、多屏及全天试用检查。
