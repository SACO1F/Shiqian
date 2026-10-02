# 拾签 v0.2.0 测试记录

日期：2026-10-02。测试平台为当前 Windows 11 x64、WebView2 环境。测试使用工程 `qa` 下的合成文件和独立 SQLite 资料库。

## 验证结果

| 验证项 | 结果 | 证据 |
| --- | --- | --- |
| TypeScript 与 Vite 生产构建 | 通过 | `evidence/release-v020.log` |
| Rust 后端测试 | 34 项通过，0 失败；1 项依赖真实桌面状态的探针默认跳过 | `evidence/core-tests-v020.log` |
| 原桌面主要流程 | 19 项通过 | `evidence/desktop-smoke-results.json` |
| 搜索、备注冲突、分页、窗口尺寸等边界 | 8 项通过 | `evidence/desktop-edge-results.json` |
| 原生关闭前备注保存 | 通过 | `evidence/desktop-close-result.txt` |
| 新进程启动读取备注 | 通过 | `evidence/desktop-restart-result.txt` |
| 独立浮窗、预设、主题、标注与窗口生命周期 | 10 项通过 | `evidence/floating-smoke-results.json` |
| 网格／列表目标高亮及标注、非文件区域拒绝 | 3 项通过 | `evidence/tag-target-results.json` |
| 真实 Windows Shell 图片路径解析 | 显式运行桌面探针，通过 | `evidence/native-shell-file-v020.log` |
| 非文件目标拒绝 | 显式运行桌面探针，通过 | `evidence/native-shell-empty-v020.log` |
| 原生释放位置识别及实际 SQLite 标注 | 通过 | `evidence/native-release-v020.txt` |
| 真实标签按下、移动、松开手势及无效目标反馈 | 通过 | `evidence/native-gesture-v020.txt` |

原有桌面回归、浮窗和目标路由合计 42 项检查。原生 Shell 探针与鼠标检查单独列出，不混计为完整跨窗口拖拽验收。

## 新增后端测试覆盖

- 默认标签只初始化一次，复用已有同名标签；用户清空预设后保持空状态。
- 预设 ID 去重、已删除标签校验以及重命名／删除／备份恢复后的同步。
- 外部路径自动入库、路径与记录 ID 混合去重，同一文件同一标签的幂等性。
- 多标签叠加及撤销，仅撤销本次新关联，保留已有标签与原文件。
- 一个批次失败时回滚此前的导入及关联写入。
- 拒绝目录、缺失标签、无效记录、空输入及应用资料库路径。

## 实际桌面验证方式

通过 CDP 连接实际 Release 程序中的 Tauri WebView，界面、IPC、Rust 逻辑与 SQLite 均为真实实现。预设创建、勾选、取消、收起展开、窗口关闭／恢复和主题切换使用实际界面操作。

文件拖入和工作台跨窗口命中采用合成的 Tauri 拖拽事件检查前端路由，随后由真实后端写入资料库。这部分验证不等同于操作系统完整的文件拖拽手势。

原生目标探针针对已观察到的 Windows 资源管理器图片位置，调用实际 Shell 和 UI Automation 实现，验证解析到正确的完整文件路径。原生释放测试将真实鼠标置于合成图片上，经 IPC 启动释放处理，最终检查实际资料库中该图片的标签。

Computer Use 执行了标签在浮窗内的真实按下、移动和松开，并验证无效目标提示。该工具限制拖拽坐标必须落在同一窗口范围内，因此未自动完成“从浮窗跨到另一个窗口”的连续物理手势。实现中的起拖、目标解析、释放提交、界面命中和结果反馈分别经过验证；完整跨窗口手势仍需用户在本机体验确认。

## 测试过程中修复的问题

- 浮窗标签样式与旧空状态插画中的同名 CSS 类冲突，改用独立样式名称，修复标签堆叠。
- 关闭主窗口后的浮窗生命周期与返回入口，确保可以继续标注并返回工作台。
- 使用独立资料库时将单实例锁按目录隔离，测试实例可以与用户正在运行的正式旧版本共存。
- 备份中的应用版本与程序版本统一从构建版本读取，避免升级后仍写入旧版本号。
- 测试脚本等待 CDP 就绪；关闭后的独立只读数据库检查等待进程退出，并对 Windows 短暂的 WAL 读取错误有限重试。

## 未覆盖的环境

- 未在全新虚拟机执行安装、卸载和升级的全流程。
- 未完成多显示器、混合 DPI、不同版本 Windows／资源管理器的完整组合测试。
- 桌面图标与第三方文件管理器的端到端物理拖拽未做完整自动化验收；第三方文件管理器本就不属于向外拖标签的支持范围。
- 未验证资源管理器卡死、海量项目 Shell 视图、突然断电、磁盘满与长时间运行。
- 本版安装包未做商业代码签名。

## 复现

```powershell
npm ci
npm run test:core
npm run package

# 设置 PLAYWRIGHT_MODULE 为可加载的 Playwright 模块位置。
# 如需新的测试库，将 SHIQIAN_QA_DATA_DIR 指向当前工程 qa 下的新目录。
node scripts/launch-qa.cjs qa/shiqian-v020-test.exe
node scripts/desktop-smoke.cjs
node scripts/desktop-edge-cases.cjs
node scripts/desktop-close-smoke.cjs
# 关闭测试会退出实例，重启后再运行浮窗测试。
node scripts/launch-qa.cjs qa/shiqian-v020-test.exe
node scripts/floating-smoke.cjs
node scripts/tag-target-smoke.cjs
```

原生路径探针需要先在 Windows 中打开合成素材文件夹，观察真实屏幕坐标，然后设置 `SHIQIAN_PROBE_X`、`SHIQIAN_PROBE_Y`、`SHIQIAN_PROBE_PATH`，运行 `cargo test --manifest-path src-tauri/Cargo.toml native_shell_target_probe -- --ignored --nocapture`。预期为非文件区域时，路径设置为 `__reject__`。坐标随窗口位置变化，不能盲目复用。

测试脚本会修改 QA 资料库，不能针对正式资料库运行。测试图片、PDF 和文本由合成素材脚本生成。
