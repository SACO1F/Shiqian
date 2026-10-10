# v0.3.0-rc.3 验证记录

日期：2026-10-11。实际 Windows Tauri release EXE 与 WebView2，合成数据均位于 qa 隔离目录；用户资料库不参与。

## 构建与核心

- 前端 TypeScript/Vite 与 release/NSIS 构建：[构建日志](evidence/rc3-bundle.log)。
- 完整核心：97 通过、0 失败、2 忽略；[核心日志](evidence/rc3-core.log)。两项忽略为可选 Shell 探针及异常终止子入口，不计为物理操作通过。
- 发布检查 4 通过，稳定验收检查 8 通过：[发布检查](evidence/rc3-release-gates.log)、[验收检查](evidence/rc3-stable-gate-tests.log)。

## 图标与标签专项

原生程序专项通过：[尺寸采样日志](evidence/rc3-card-chrome.log)。脚本 scripts/rc3-card-chrome-regression.cjs 仅操作 qa/rc3-chrome/library 合成 Markdown 与 PNG。

专项在浅/深色下采样详情展开与收回期间的 SVG 图标、标签与卡片尺寸：Markdown 图标保持 40×40、测试标签宽高误差小于 0.35px，同时卡片宽度在约 260.8 与 188.3 之间继续过渡。减少动态效果模式无卡片动画且图标保持 40×40。无未捕获页面错误，测试后通过正常退出关闭 QA 程序。

## 实现与范围

外层卡片仍运行位移和缩放；内部 UI 使用逐段倒数缩放，在同一缓动时间线上抵消外层 scaleX/scaleY。使用单独 scale 属性，保留原有 transform 悬停和勾选动画。图片像素继续随卡片缩放，布局测量仍使用 offsetHeight。

本轮未改动资料包实现，沿用 RC.2 的 v2 分类和 v1 兼容。没有重新执行跨电脑、混合 DPI、干净系统安装或八小时测试；剩余项目见[正式验收](stable-release-acceptance.md)。

package-release.py 检查六处版本、两份二进制、源码 ZIP 和 SHA256；本地交付证据记录在 docs/evidence/rc3-delivery.log，生成于 ZIP 之后并排除循环打包。

[候选说明](release-v0.3-rc3.md) · [使用说明](user-manual-v0.3.zh-CN.md)
