# drawio-digit

基于 draw.io 的数字时序图编辑器。当前版本可以编辑 WaveJSON、实时预览波形，并把源码和 SVG 一起保存到 `.drawio` 文件。

## 本地运行

需要 Node.js 20 或以上版本、npm、Python 3 和 Git。在仓库根目录运行：

```shell
git submodule update --init
npm ci
npm start
```

打开 [本地编辑器](http://127.0.0.1:8765/?lang=zh&ui=kennedy)。服务绑定到本机，按 Ctrl+C 结束。`npm run build` 单独生成 `dist/`，也可从此目录部署静态站点。

## 绘制和编辑波形

1. 点击工具栏的 **＋ → WaveDrom 波形图**。对话框会显示一份握手信号示例。
2. 把 `ready` 行的 `wave` 从 `'01..'` 改为 `'0.1.'`，可以看到上升沿推迟一拍。语法错误会显示在编辑框下方，上次有效预览会保留。
3. 点击 **应用**，再用 draw.io 的 **文件 → 保存** 保存为 `.drawio`。重新打开文件，双击波形即可继续编辑原始 WaveJSON。应用一次对应一次撤销。

普通 draw.io 可直接显示嵌入的波形图。在本项目的编辑器中打开同一个文件即可编辑源码。SVG 和 PNG 导出沿用 draw.io 的文件菜单。

## 验证

本地服务启动后，在另一个终端运行 `npm run test:browser`。回归测试使用本机 Chrome；若使用 Edge，可将环境变量 `CHROME_CHANNEL` 设为 `msedge`。测试覆盖实时预览、无效输入、撤销重做、文件往返、双击编辑和图像导出。
