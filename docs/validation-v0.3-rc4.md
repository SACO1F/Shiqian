# v0.3.0-rc.4 验证记录

日期：2026-10-11。Windows 实际 Tauri release EXE 与 WebView2，合成资料库位于项目 qa；日常资料库不参与。

## 构建与核心

- TypeScript/Vite、release EXE 和 NSIS 通过：[构建日志](evidence/rc4-bundle.log)。
- 完整核心 97 通过、0 失败、2 忽略：[核心日志](evidence/rc4-core.log)。忽略为可选 Shell 探针与主动终止子进程入口，不计为物理验收通过。
- 发布检查 4 通过、正式验收检查 8 通过：[发布检查](evidence/rc4-release-gates.log)、[验收检查](evidence/rc4-stable-gate-tests.log)。

## 列数与连续尺寸专项

[移动回归](evidence/rc4-gallery-motion.log)：

- 增加列数、减少列数时有非零平移的卡片动画，过渡结束后卡片无重叠。
- 在实际 WebView 内将视口 1360→1180→1360 分为 62 次尺寸更新，完成 1,488 个已有卡片的列分配与单调尺寸观察。列不跳变，尺寸跟随调整方向变化；连续调整期间没有重启动画，没有重叠。
- 1100、960、1360 窄/宽视口布局正常；8→5→8 自动列数容量变化无重叠。
- 减少动态效果模式跳过列数动画，无未捕获页面错误。

最初尝试原生 plugin:window|set_size 命令，被应用 ACL 拒绝：[接口限制](evidence/rc4-gallery-motion-native-acl.log)。未扩大生产权限，随后通过 CDP 设置实际 WebView 视口，触发 window.resize 与 ResizeObserver 路径；这不能冒充物理鼠标拖动、Windows 吸附或混合 DPI 验收。

脚本：scripts/rc4-gallery-motion-regression.cjs。SHIQIAN_QA_DATA_DIR=qa/rc4-layout/library，BETA_QA_DIR=rc4-layout，BETA_VERSION=0.3.0-rc.4。合成 PNG 来自 qa/gallery-fixtures。

## 兼容回归

- [原有界面回归](evidence/rc4-ui-compat.log)：已有标签排除、16 个未用标签、部分文件缺失的标签可批量添加；12 次完整详情开关在滚动 1800 时均保持 1800；浅深色筛选和密度样式一致，无页面错误。
- [图标/标签尺寸回归](evidence/rc4-card-chrome.log)：浅深色下 Markdown/PNG 选择与取消，图标保持 40×40，测试标签宽高误差小于 0.35px；卡片继续过渡，减少动态效果跳过动画，无页面错误。脚本 rc3-card-chrome-regression.cjs 用 BETA_VERSION 指定 RC.4。
- 测试程序均通过正常关闭退出。资料包代码未修改，兼容性沿用 RC.2/RC.3 核心回归，本轮完整核心继续覆盖它。

## 交付与边界

package-release.py 校验六处源码版本、两份二进制、源码 ZIP 和 SHA256。交付记录 docs/evidence/rc4-delivery.log 在 ZIP 完成后生成，避免循环打包。

本轮没有执行另一台电脑、多屏物理拖拽、干净系统安装或八小时测试；见[实机验收清单](stable-release-acceptance.md)。

[候选说明](release-v0.3-rc4.md) · [使用说明](user-manual-v0.3.zh-CN.md)
