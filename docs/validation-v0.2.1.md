# 拾签 v0.2.1 验证记录

日期：2026-10-04。环境：当前 Windows x64、Tauri Release WebView。测试资料使用工程 `qa/` 下合成文件和独立 SQLite 数据库；没有使用个人图片或正式资料库。

## 本次变化

- 图片瀑布流：按预览比例布局、动态测量、虚拟渲染、悬停信息。
- 图片列数：2～8 列偏好、空间不足时自动收缩、放大／缩小与滑杆控制。
- 左侧菜单：图标模式、可展开标签入口、可访问名称与状态保存。
- 后端设置：新布局设置的类型／范围校验与顺序保存；正常关闭等待偏好写入。

## 验证范围

| 检查 | 内容 | 证据 |
| --- | --- | --- |
| 前端与发布构建 | TypeScript、Vite、Rust Release、NSIS 安装包 | `evidence/release-v021.log` |
| Rust 后端 | 35 项通过；1 项依赖可见 Shell 目标的原生探针默认跳过 | `evidence/core-tests-v021.log` |
| 桌面基础流程 | 19 项：导入、多标签、备注、撤销、备份恢复、预览、主题与列表 | `evidence/desktop-smoke-v021.json` |
| 桌面边界 | 8 项：空格、IME、备注冲突、960／1280／1920 宽度、284 文件虚拟渲染与分页、无外部请求 | `evidence/desktop-edge-v021.json` |
| 图片浏览 | 8 项：不同比例、无重叠、隐藏元信息、列数切换、收拢菜单、重载持久化、窄窗口恢复、分页、悬停和预览、损坏图片与主题 | `evidence/gallery-results-v021.json` |
| 标注目标路由 | 3 项：瀑布流／列表准确命中，非文件区域拒绝 | `evidence/tag-target-v021.json` |
| 标签浮窗回归 | 10 项：侧栏入口、预设、自动入库、幂等与撤销、窗口切换和主题同步 | `evidence/floating-smoke-v021.json` |
| 重启保存 | 最终 Release 新进程读取上次关闭保存的备注、4 列偏好与收拢状态 | `evidence/desktop-restart-v021.txt` |
| 关闭保存 | 编辑备注后立即关闭，通过独立 SQLite 读取核验 | `evidence/desktop-close-v021.txt` |

桌面相关检查合计 50 项。页面顶部精简后的最终 Release 再次通过图库、浮窗、目标路由与关闭检查，最终 EXE 的启动读取也已核验。

这些是当前测试环境的结果，不代表所有 Windows、显卡或 DPI 组合已验证。新增脚本为 `scripts/gallery-smoke.cjs` 和 `scripts/make-gallery-fixtures.py`。图库素材覆盖横图、竖图、方图、损坏图片与普通文档。

## 复现要点

先运行 `npm ci`、`npm run test:core` 和 `npm run package`。使用 Pillow／ReportLab 执行原合成素材脚本，用 Pillow 执行图库素材脚本。将最终 EXE 复制到 `qa/` 后，以 `SHIQIAN_QA_DATA_DIR` 指定项目 `qa/` 内新的测试库，再运行 `scripts/launch-qa.cjs`。

设置 `PLAYWRIGHT_MODULE` 为可加载的 Playwright 模块路径，依次运行桌面基础、边界、图库和标注目标脚本；关闭测试最后执行。脚本会修改合成资料库，不能针对正式资料库运行。测试路径和自动化事件细节沿用 [v0.2.0 记录](validation-v0.2.md)。

## 仍未完成的验收

未新增完整跨应用连续物理拖拽、多显示器混合 DPI、干净系统安装／升级／卸载和长期运行测试。标注目标脚本通过定向 Tauri 事件检验界面路由与真实数据库写入，不能等同于操作系统手势验收。图片首次加载时可能因实际比例替换占位比例而轻微调整位置。安装包继续作为未签名的体验版交付。
