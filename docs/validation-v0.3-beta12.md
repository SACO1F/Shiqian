# v0.3.0-beta.12 验证记录

日期：2026-10-10。主项目 D:\AI\Shiqian 已可写，本轮直接完成源码修改及本地候选构建。以 Beta.12 预发布候选交付，仍需稳定版实机验收。

## 已通过

- TypeScript / Vite 生产构建与 Windows x64 Tauri release 编译。
- NSIS 安装包生成。首次构建等待 NSIS 工具下载后成功；第二次使用已缓存工具构建，避免再次下载。
- 3 项版本与交付门槛测试。
- 最终交付 EXE 的侧栏回归通过；源码 ZIP 完整性、五个交付资产 SHA256、六处源码版本和两个原生二进制版本校验通过。
- 真实桌面 WebView 分隔条回归：拖动和宽度持久化、阈值收起、缓动展开、拖动展开、最大宽度、Escape 取消、Home/方向键、减少动态效果、小窗口及无卡片重叠。
- 在真实 WebView 中临时移除新增焦点覆盖规则，复现原有 2px 矩形焦点框；恢复规则后 computed outline 为 none，细竖线提示保留。测试仅改变合成测试实例的内存 CSS，不修改生产文件。
- 首次引导真实桌面回归：首次 AI 提醒、跳过 AI、四步说明、中途刷新恢复、完成后不重复、偏好设置重看、关闭提醒后说明可操作、无效配置不推进、真实后端保存配置后推进、浅色/深色、小窗口、标签浮窗不显示引导及无未捕获页面错误。
- 正常关闭合成测试实例后重新启动，完成记录和已保存配置保留。

所有桌面回归使用项目 qa/beta12-onboarding/library 独立资料库，未读取用户真实资料或调用远程模型。保存期间阻止关闭的模拟测试已在上一轮浏览器回归完成；本轮原生测试验证实际保存后的跳转，不将模拟延迟视为真实 IPC 延迟。

## 研究范围

Word/Excel 依赖仅下载到 .build/preview-study 测量，没有加入生产依赖；当前预览能力不变。DOCX/JSZip 脚本大小已实测，SheetJS 当前资源下载返回 403，未报告其准确增量。最终 Word/Excel 集成的安装器增量仍需以后做 A/B 构建。

本轮为样式修复和引导前端合入，无 Rust 业务代码修改，未重复运行完整核心套件。真实 AI 服务、API Key 加密、Office 新渲染器兼容性及安装器实际升级安装不在本轮通过范围。

## 证据

- [原生构建](evidence/beta12-bundle.log)
- [缓存工具构建](evidence/beta12-bundle-cached-tools.log)
- [分隔条焦点回归](evidence/beta12-sidebar-focus.log)
- [最终交付 EXE 回归](evidence/beta12-sidebar-delivery.log)
- [首次引导原生回归](evidence/beta12-onboarding-native.log)
- [真实进程重启](evidence/beta12-onboarding-restart.log)
- [交付门槛](evidence/beta12-release-gates.log)

研究与测量记录在源码包 `docs/file-preview-research-2026-10-10.md`、`docs/evidence/preview-library-sizes-2026-10-10.csv` 和 `docs/evidence/preview-current-pdf-sizes-2026-10-10.log`。

[候选说明](beta-v0.3-beta12.md)
