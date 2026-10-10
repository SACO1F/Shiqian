# 拾签 v0.3.0-beta.6 验收记录

日期：2026-10-10。Windows 开发电脑，真实生产 Tauri/WebView2，独立合成资料库 `qa/beta6-ui/library`；数据库 schema 2。

## 本轮验证

| 场景 | 验证 | 证据 |
|---|---|---|
| 右侧拖动提示 | 向真实 Tauri 事件通道注入拖动坐标，详情面板开/关时，靠近右边缘的提示继续水平跟随，并保持在窗口内；在图片坐标命中文件后仍有高亮 | [交互回归](evidence/beta6-interaction.log) |
| 工作台创建标签同步 | 无选中文件时，通过工作台添加按钮创建普通标签，已经打开的真实浮窗自动显示该标签 | [交互回归](evidence/beta6-interaction.log) |
| 工作台使用既有标签同步 | 从浮窗取消预设后，在详情为文件添加该普通标签，浮窗重新显示；原快捷标签保留且无重复 | [交互回归](evidence/beta6-interaction.log) |
| 四处选择器 | 浅/深色：状态、匹配方式、排序、密度均可点击选择；高亮平滑移动，短菜单不出现取整滚动条；密度保存；方向键、Home、Enter 正常，Escape 关闭菜单且保留偏好设置对话框 | [交互回归](evidence/beta6-interaction.log) |
| 两个添加按钮白边 | 浅/深色下工作台和浮窗按钮边缘计算值为透明，不包含内侧亮线阴影 | [交互回归](evidence/beta6-interaction.log) |
| 减少动态效果 | 减少动态效果模式下选择菜单没有动画；无未捕获页面错误 | [交互回归](evidence/beta6-interaction.log) |
| 既有详情与样式回归 | 12 轮详情开关滚动位置均保持 1800；已应用标签排除、16 个未应用标签完整可选、批量补齐正确；四处选择器基本圆角/字号/间距/底色一致 | [界面回归](evidence/beta6-ui-regression.log) |
| 核心测试 | 94 项通过、0 失败、2 项可选压力测试忽略；新增工作台标签预设持久化/去重/文件夹排除、失败标注不加入预设、AI 明确接受后加入预设测试 | [核心测试](evidence/beta6-core.log) |
| 发布构建 | TypeScript/Vite、Tauri release、NSIS 构建通过，六处源码版本及原生程序版本核对，版本门禁三项通过 | [版本门禁](evidence/beta6-release-gates.log) |

## 调整记录

- 初次核心测试编译因测试 JSON 的键移动了文件 ID，改用克隆；生产代码无该问题，正式 94 项通过。
- 初次选择器测试在收回动画期间使用标签定位，匹配了触发器和菜单两个元素；改为明确的 combobox 定位。
- 重跑测试时沿用了上次关闭详情面板的偏好，测试改为显式恢复详情展开状态。
- 回归发现旧「结果工具栏按钮」CSS 覆盖排序选择器的圆角、字号和间距；提高新选择器规则优先级后统一。
- 菜单最大高度补上实际边框厚度，避免短菜单出现两像素滚动范围。

初始证据保留：`docs/evidence/beta6-core-initial.log`、`beta6-interaction-initial.log`、`beta6-interaction-details-initial.log`、`beta6-ui-style-initial.log`。

## 范围与边界

视觉参考：[React Bits Glide Select](https://reactbits.dev/c/micro/glide-select)。独立实现弹出与滑动高亮，沿用现有图标和主题，无新增第三方图标依赖。菜单挂到页面顶层，支持屏幕边缘避让；不被筛选面板裁切。

拖动测试验证真实应用事件处理与 DOM 命中、高亮和提示位置，未用物理鼠标重复跨窗口拖拽。标签保存与标注均验证真实数据库和已经打开的浮窗；待确认 AI 标签、文件夹标签规则由核心测试覆盖。

本轮未执行安装器覆盖安装或卸载，也未重复跨设备、混合 DPI 与全天运行验收。

使用说明见 [Beta.6 指南](beta-v0.3-beta6.md)。
