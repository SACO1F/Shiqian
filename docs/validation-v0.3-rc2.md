# v0.3.0-rc.2 验证记录

日期：2026-10-11。Windows 开发电脑，实际 Tauri release EXE 与 WebView2。所有回归均使用 qa 下独立资料库和合成文件，未操作日常资料库。

## 构建与核心

- npm run package：release 与 NSIS 安装器通过；[原生构建](evidence/rc2-bundle.log)。
- npm run build：TypeScript/Vite 通过；代码格式化后前端资源字节与已打包版本一致；[前端构建](evidence/rc2-build.log)。
- cargo test --locked --offline --manifest-path src-tauri/Cargo.toml --lib：**97 通过、0 失败、2 忽略**；[核心日志](evidence/rc2-core.log)。忽略项为主动终止子进程入口及可选 Shell 探针，不替代实机验收。
- 资料包专项：14 通过、0 失败、1 忽略；其中新增三个测试覆盖 3 Pic + 5 Desktop、同目录同名不覆盖、旧 v1 归类与拒绝路径穿越/盘符/保留名；[资料包专项](evidence/rc2-transfer.log)。
- 发布检查 4 通过、验收检查 8 通过；[发布检查](evidence/rc2-release-gates.log)、[验收检查](evidence/rc2-stable-gate-tests.log)。稳定验收仍未完成，不标为正式 0.3.0。

## 原生界面专项

[专项日志](evidence/rc2-details-transfer.log)：

- 在 127 文件的瀑布流中滚动至 1800，选择可见卡片，详情展开后选中卡片仍在视野内。
- 实际执行 300ms cubic-bezier(0.42, 0, 0.58, 1) 卡片动画，采样宽度 260.8 → 255.9 → 236.4 → 209.5 → 192.3 → 188.3；单调变化，无缩放来回震颤。
- 「已选 1 项」保持，计数左缘在动画采样中位移小于 1px。
- 导出范围为 Glide Select，菜单 class、方向键/Enter 选择、Escape 关闭与焦点正常。
- 无未捕获页面错误；空选择时详情开关保持滚动。

[兼容界面回归](evidence/rc2-ui-compat.log)：16 个未用标签候选可查看和应用，已添加标签不重复，部分文件缺少的标签仍可批量添加；12 次完整详情开关滚动位置均为 1800；浅/深色筛选和密度选择器一致，无页面错误。

布局高度取 offsetHeight，避免动画 transform 改变测量值，导致虚拟瀑布流反复更新。手动详情开关的固定偏移与首次选择的居中聚焦分别处理。

## 原生资料包交接

[同机双库日志](evidence/rc2-native-transfer.log)：发送端界面预览/导出、所选/标签范围；接收端增量导入、文件名/哈希/标签来源/备注/收藏、无 AI 任务；重复导入拒绝；深色/窄屏/减少动态效果对话框通过。

新版默认导出 v2；新版兼容读 v1。旧包原目录信息缺失时只能使用文件夹来源标签，不能恢复不存在的元数据。用户此前另一台电脑导入后出现数字目录的问题由本轮修复覆盖，尚需在接收电脑用 RC.2 新包复核；同机双库不冒充跨电脑通过。

## 重跑与边界

界面专项：启动 release EXE，SHIQIAN_QA_DATA_DIR 指向 qa/rc2-ui/library，BETA_QA_DIR=rc2-ui，BETA_VERSION=0.3.0-rc.2，运行 scripts/rc2-details-transfer-regression.cjs。首次引导由脚本实际点击跳过/开始使用；fixtures 来自 qa/gallery-fixtures 的合成 PNG。Playwright 可通过 PLAYWRIGHT_MODULE 指定安装路径。

旧界面兼容用 beta4-ui-regression.cjs；资料包用 beta-transfer-desktop-smoke.cjs，在新发送库和接收库分别运行 BETA_PHASE=send/receive。每次测试正常关闭，不复用用户资料。

最后以 package-release.py 校验六处源码版本、两份二进制版本、源码 ZIP 和 SHA256。交付日志在源码目录 docs/evidence/rc2-delivery.log，生成于 ZIP 之后并排除循环打包。

本轮没有重新执行八小时持续使用、干净系统安装、物理混合 DPI 或另一台电脑验收；RC.1 的五分钟记录属于上一轮基线。剩余项目见[稳定验收](stable-release-acceptance.md)。

[候选说明](release-v0.3-rc2.md) · [交接步骤](colleague-handoff-v0.3.zh-CN.md)
