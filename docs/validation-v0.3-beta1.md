# v0.3.0-beta.1 验收记录

日期：2026-10-10。环境：Windows 11 家庭版中文 x64（10.0.26300），Intel Core i7-10870H。所有资料为隔离 `qa/` 目录内的合成内容。

## 当前结果

| 项目 | 结果及证据 |
| --- | --- |
| 全部 Rust 核心测试 | 83 通过、2 跳过；含资料包、备份恢复、schema 1 升级、AI、文件身份、事务与查询。跳过的是原生可见文件探针和由父测试单独调用的异常终止子进程。`evidence/beta-full-core.log` |
| 无 WebView 核心专项 | 43 通过、1 跳过；直接编译生产模块，包含新增资料包检查。`evidence/beta-core.log` |
| alpha.17 → beta.1 | 实际运行旧版建立合成资料库，关闭后运行新版；标签、备注、路径、文件身份、主题与侧栏宽度保持一致；旧备份可校验恢复，保护备份产生。`evidence/beta-upgrade.log` |
| 资料包收发 | 两份独立资料库；实际界面导出、预览、追加导入、重复导入拦截；文件名、SHA-256、标签来源、备注与收藏匹配；无新 AI 任务；深浅主题、960 px 宽度、减少动态效果与 JavaScript 错误检查。`evidence/beta-transfer-desktop.log` |
| 大文件取消 | 1 GB 文件实际导出途中取消，未发布部分资料包；另成功导出该文件，校验后于接收复制阶段取消，接收目录与新增标注清理、原文件保留、任务锁释放。`evidence/beta-transfer-cancel.log` |
| 包异常及事务 | 损坏内容、未知／越界条目、过期预览、缺失／变化源文件、同名输出、同名原文件、数据库触发失败、重复导入、中文长路径；整批回滚。见核心测试 |
| 异常退出 | 独立 Rust 测试子进程真实 abort 后，已提交标签保留、未提交标签回滚并通过完整性校验；资料包中断记录的重启恢复另外通过模拟标记验证。没有声称测试了硬件断电或物理磁盘故障 |
| 规模基线 | 10,000 文件记录、40 标签、30,000 关联、中文备注、120 次组合查询；P50 113.64 ms，P95 137.46 ms，最大 159.46 ms。这是本机 debug 后端测量，不含图片解码或 UI 绘制。`evidence/beta-benchmark.log` |
| 连续操作基线 | 180.05 秒，964 轮备注／查询；切换布局／主题，开关浮窗、重载；文件数不变、无页面异常；主页面回收后 JS 堆 5,382,480 → 4,572,008 字节，DOM 节点 572 → 572。仅记录本轮观察，不等于全天或所有 WebView 内存认证。`evidence/beta-soak.log` |
| 既有界面与业务回归 | 最终构建通过 AI 自动标注 10 组、Apple 标签与浮窗 6 组、瀑布流布局 35 场景、alpha.17 操作反馈 7 组。`evidence/beta-auto-tags.log`、`beta-apple-tags.log`、`beta-gallery.log`、`beta-micro-experience.log` |
| 交付构建 | TypeScript、Vite、Rust release、NSIS 完成。交付 EXE 与最后测试的运行副本散列一致；源码 ZIP 完整性及交付资产 SHA-256 校验。`evidence/beta-package.log`、`beta-delivery.log` |


## 复现入口

```powershell
npm run test:core
npm run test:auto-tags
npm run package
```

桌面脚本通过真实 WebView IPC 运行。先为应用设置 `SHIQIAN_DATA_DIR` 指向全新的 `qa/` 子目录，设置 WebView2 的 `--remote-debugging-port=9223`，然后运行：

- `scripts/beta-transfer-desktop-smoke.cjs`：`BETA_PHASE=send` 建立发送资料；关闭后以另一个新数据目录运行应用，`BETA_PHASE=receive` 验证接收。`BETA_QA_DIR` 可选择新的合成资料输出目录。
- `scripts/beta-upgrade-desktop-smoke.cjs`：`BETA_PHASE=seed` 配合 alpha.17，`BETA_PHASE=verify` 配合 beta.1，同一隔离数据目录。
- `scripts/beta-transfer-cancel-smoke.cjs`：需要约 2 GB 临时空间；仅操作隔离目录里的合成大文件。
- `scripts/beta-soak-desktop.cjs`：默认 180 秒，可设 `SOAK_MS` 延长；需已有合成文件。脚本会修改这些测试文件的备注和外观。

`PLAYWRIGHT_MODULE` 指向本机 Playwright 模块位置。测试脚本对资料库路径有 `qa/` 守卫，不应对真实用户资料运行。

资料包规范和限制见 [Beta 使用说明](beta-v0.3-beta1.md)。软件将原件与标注导入到新路径；原系统路径无须相同，同名文件置于不同编号目录，标签按名称复用。

## 尚未通过的环境验收

- 干净系统安装、缺失 WebView2、Windows 新用户、安装器覆盖旧安装、卸载后的数据保留。本轮升级验证的是程序版本读取同一资料库，不是安装器覆盖安装。
- 不同实体电脑／实际不同盘符／网络盘的资料包收发及权限差异。
- 双屏混合缩放、完整原生跨窗口拖拽手势与浮窗的位置恢复。
- 全天运行、十万级真实图片库、缓存增长、系统休眠／唤醒、硬件断电与磁盘故障。

这些项目应在 beta.2 前优先安排。beta.1 是可分发的小范围候选，不作为上述环境已验收的证明。
