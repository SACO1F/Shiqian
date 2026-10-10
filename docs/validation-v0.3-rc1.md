# v0.3 稳定交付候选 RC.1 验证记录

日期：2026-10-11。版本：0.3.0-rc.1。环境：当前开发 Windows 电脑及 WebView2；隔离数据全部位于项目 qa，使用合成文件。日常资料库不参与。

## 自动化与构建

| 项目 | 结果 | 证据 |
| --- | --- | --- |
| 完整 Rust 核心回归 | 94 通过、0 失败、2 忽略；实际 DPAPI、异常中止恢复、资料包故障、万文件查询覆盖 | [核心日志](evidence/rc1-core-initial.log) |
| 前端构建 | npm run build 通过 | [构建日志](evidence/rc1-build.log) |
| 原生 release 与 NSIS | npm run package 通过 | [打包日志](evidence/rc1-bundle.log) |
| 版本与二进制发布检查 | 4 个测试通过，包含正式版本被阻止时不写资产 | [发布检查](evidence/rc1-release-gates.log) |
| 实机验收检查 | 8 个测试通过，当前真实清单未完成时正确阻止 | [验收检查](evidence/rc1-stable-gate-tests.log) |
| 正式版本集成保护 | --version 0.3.0 正确退出失败，没有创建稳定版交付目录 | [阻止正式打包](evidence/rc1-stable-package-blocked.log) |
| 依赖声明 | 279 个唯一条目；45 个依赖无顶层 license 文件，不计为已完成法律审计 | [声明收集](evidence/rc1-notices.log) |

两项忽略为可选 Shell 实机入口和主动终止子进程的测试入口，异常中止恢复的父测试已通过；忽略项不视为物理鼠标或干净系统测试通过。

## 实际 EXE 界面和数据回归

- 首次 AI 提醒 → 暂不设置 → 快速说明、说明中刷新、保存实际配置、浅/深色、960×640、小浮窗无新手弹窗、无未捕获页面错误：[首次启动](evidence/rc1-onboarding.log)。测试配置指向本机占位地址，未调用模型或读取真实文件。
- 真实退出和重新启动后，不重复弹说明，配置仍保留：[重启验证](evidence/rc1-onboarding-restart.log)。原生场景不冒充浏览器模拟的人工延迟保存测试。
- 单击重复选中/取消、Ctrl/Shift、常驻排序与操作、工具提示、键盘、导出/移除取消；127 个结果 Ctrl+A，输入框保持原生全选。
- 16 个未用标签候选可滚动和添加，已有标签排除，部分文件缺失的标签仍可批量添加；12 次详情切换在滚动 1800 时均保持 1800。
- 浅/深色下筛选、排序和密度选择器；标题栏最大化/还原/关闭处理；侧栏拖拽/键盘/自动收起/记忆宽度/reduced motion；焦点方框复现后确认修复。窗口动作是程序 API 和 DOM 自动化，不替代物理鼠标与混合屏测试。
- alpha.10 → RC.1、Beta.12 → RC.1：实际旧 EXE 创建的文件身份、路径、标签、备注、收藏、主题、侧栏与浮窗保持，旧备份检查/恢复成功并生成保护备份。这是数据兼容测试，不是安装器实机验收。
- 同机两个独立库：发送端导出、接收端增量导入，文件哈希、标签来源、备注、收藏核对；重复导入拒绝且不增加重复文件；无自动 AI 任务。

上述原生回归集中证据：[原生程序日志](evidence/rc1-native-regression.log)。历史 alpha.10 没有 package.status 接口，通用关闭脚本首次停止；之后在核对旧版版本和隔离目录、无导入任务后正常关闭旧版，完成升级测试。此为测试工具兼容问题，未通过强制杀进程替代正常关闭。

## 持续使用与安装边界

五分钟持续操作通过：300.102 秒、1,420 次备注/查询循环，穿插布局/主题切换、浮窗开关与页面重载；文件数保持 127，无未捕获页面错误。主页面回收后 JS 堆从 4,704,044 到 5,582,240 字节，DOM 节点从 1,160 到 1,114；这是观察基线，未测全过程峰值/全进程泄漏。短时基线不替代八小时实机验收。

NSIS 生成脚本确认清除用户数据位于用户勾选条件下，记录[安装脚本摘录](evidence/rc1-installer-script.log)。未在日常用户下静默安装/卸载，当前环境无 Windows Sandbox。该检查不证明实际安装升级已完整通过。

[同事反馈](evidence/rc1-colleague-feedback.md)说明保留信息后重新安装可直接使用，新旧版本/环境未提供。跨电脑未测试，暂时无使用问题尚无持续时长。

## 交付与剩余门槛

本地源码 ZIP、文档、六处版本、两个二进制版本和 SHA256 由 package-release.py 检查；证据在源码内 docs/evidence/rc1-delivery.log（生成于源码打包之后，ZIP 不包含这份循环生成记录）。本轮候选未发布到 GitHub。

完整剩余项目见[实机验收清单](stable-release-acceptance.md)，包括干净系统/无 WebView2、逐项安装升级和卸载数据、跨电脑包、真实权限/空间和外接盘、多屏 DPI/断屏休眠、物理拖拽及至少八小时使用。当前版本保持 RC.1，正式 0.3.0 打包被检查脚本阻止。

[候选交付说明](release-v0.3-rc1.md) · [使用说明](user-manual-v0.3.zh-CN.md) · [已知限制](known-issues-v0.3.md)

## 重跑方法

核心命令：`cargo test --locked --offline --manifest-path src-tauri/Cargo.toml --lib`；构建命令：`npm run build`、`npm run package`。依赖环境使用项目已有离线缓存。

原生 QA 通过 `scripts/launch-qa.cjs` 启动 release EXE，设置 `SHIQIAN_QA_DATA_DIR` 为项目 qa 下独立 library，并通过 CDP 9223 操作。设置 `BETA_VERSION=0.3.0-rc.1` 与对应 `BETA_QA_DIR`；Playwright 可用 `PLAYWRIGHT_MODULE` 指定本机模块路径。首次提醒用界面暂不设置并完成说明。

界面组依次运行 beta9-toolbar-regression、beta4-ui-regression、beta10-stability-regression、beta9-titlebar-regression、sidebar-resize-desktop-smoke 的 `.cjs` 脚本。先将 qa/gallery-fixtures 的合成 PNG 复制到 qa/rc1-ui；toolbar 会导入隔离库，stability 要求库有超过 100 个文件。

升级组使用 alpha10-beta9-upgrade-smoke.cjs，设置 `BETA_UPGRADE_DIR`、`BETA_BASE_VERSION`，旧版运行 `BETA_PHASE=seed`，正常退出后启动 RC.1 再运行 `BETA_PHASE=verify`。旧 alpha.10 没有 package.status，关闭前核对版本与隔离数据目录、导入状态，关闭浮窗，再请求原生 main 关闭；不要直接杀进程。

资料包组使用 beta-transfer-desktop-smoke.cjs，`BETA_QA_DIR=rc1-transfer`，发送端和接收端使用 qa/rc1-transfer/send/library 与 receive/library，分两次启动，阶段 `BETA_PHASE=send/receive`。每次必须使用新库，不复用真实资料。

持续操作脚本为 beta-soak-desktop.cjs，设置 `SOAK_MS=300000`。测试后用 close-qa.cjs 正常退出。脚本检查隔离路径与版本，不要向真实库开放调试端口。

发布检查：`python scripts/test-release-gates.py`、`python scripts/test-stable-release-gate.py`；生成候选：`python scripts/package-release.py --version 0.3.0-rc.1`。现存二进制与新构建不同会阻止覆盖，需要验证后显式使用 --refresh-binaries。
