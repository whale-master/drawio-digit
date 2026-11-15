# 画布插件集成调查

以下定位来自当前仓库的静态源码。实际事件优先级与屏幕命中仍须浏览器验证。下表 vendor 内路径的公共前缀为 vendor/drawio/src/main/webapp/。

| 仓库位置 | 结论 |
| --- | --- |
| scripts/build.mjs:9、16、19 | 分别配置 esbuild 入口、插件注册和默认启用列表。新增独立插件需贯通三处。 |
| src/wavedrom/plugin.js:40、135 | 已有图像和源码保存到同一图元、同一事务，以及 Draw.loadPlugin 和宿主回退的示例。 |
| plugins/number.js:41 | setToggleAction/setSelectedCallback 和视图菜单可用于模式开关。 |
| js/grapheditor/EditorUi.js:11094、11301；js/diagramly/EditorUi.js:2214 | 原生方向键按选区分发；Shift+Enter 已用于格式面板，宿主还会包装 getFunction。 |
| mxgraph/src/view/mxGraph.js:13063 | getPointForEvent 在缩放和平移换算后调用普通网格 snap；需使用未吸附坐标计算周期。 |
| js/diagramly/Pages.js:552、1512 | 编辑器发出并监听 pageSelected，可用于清理会话状态。 |
| js/grapheditor/Graph.js:38737、38748、40861 | 提供图元属性读写以及 getSvg 导出入口。 |
| tests/wavedrom.test.cjs:10、46、82 | 现有 Playwright 用例覆盖本地编辑器、事务、保存重开和导出，可沿用相同环境。 |

## 全键盘流程的宿主键位

js/grapheditor/EditorUi.js:11353 已将 F2 用于原生图元编辑。流水模式仅在网格焦点且命中方块时将其用于块名称。当前 grapheditor 与 diagramly 源文件中对 F8 的文本检索仅命中 js/diagramly/EditorUi.js:31487 的键名表。F8 的实际投递与进出焦点仍须结合本地浏览器验证。

前端 spec 多处仍为模板。跨层指南适用于验证键鼠输入、结构数据、显示图元和文件重开之间的往返。
