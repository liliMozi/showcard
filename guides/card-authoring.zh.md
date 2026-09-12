# 制作第一张 Showcard

[English](card-authoring.md) · [项目入口](../README.zh.md) · [规范正文](../spec/1.0.md)

卡片作者负责 HTML 和资产文件；宿主实现者负责运行时、存储和工具网关。
制作卡片不要求先实现一个宿主。

## 从可运行的卡片开始

使用 Node.js 22.13+ 或 24+，在仓库根目录运行：

```sh
npm ci
npm run demo
```

打开终端打印的本地地址。编辑便笺并移开焦点，刷新宿主页面，确认内容仍然保留。
点击时间按钮，卡片会调用宿主的 `demo.time.now`，收到 ISO 时间戳。
这个示例不调用网络工具，不需要 API Key，也不调用 LLM。

卡片源码位于 [examples/host/card/](../examples/host/card/)：

```text
card/
  index.html
  assets/style.css
```

复制整个目录即可制作新卡片。入口是完整 HTML 文档，带自然语言 `<title>`，
资产使用相对路径，不嵌入凭据。包不自行分配实体 ID，身份由接收它的宿主分配。

## 选择合适的机制

| 目标 | 用法 |
| --- | --- |
| 记住输入内容 | `data-persist="note"`，或 `card.state.set("note", value)` |
| 读取保存状态 | `await card.state.get()`，先检查 `ok`，再读 `result.state` |
| 调用宿主工具 | 在 `data-card-manifest` 声明绑定，再用 `card.invoke(bindingId, input)` |
| 无 JavaScript 接线 | 按钮用 `data-invoke="bindingId"`，输出区用 `data-result="bindingId"` |
| 通知某个会话 | 先协商 `emit`；成功回执不是 Agent 的回复 |
| 使用宿主扩展 | 同时检查其已文档化的能力与方法，明确处理不可用状态 |

`demo.time.now` 这样的工具名由宿主提供，不代表其他宿主一定有同名工具。
作者应决定绑定不可用时显示什么。能力存在不等于用户已经授权。

## 校验交付物

```sh
node conformance/bin/check-card.mjs examples/host/card
npm run cli -- validate examples/host/card
npm test
```

当前源码的两个检查入口都支持单文件、目录包和 `.card.zip`；封装 CLI 还支持递归
查找集合目录中的卡片。退出码 0 表示没有错误，但可能有警告；1 表示卡片内容有错；
2 表示命令无法读取或检查目标。

npm 上的版本可能落后于仓库。要复现当前源码行为，使用上面的源码命令；
[CLI 文档](../packages/showcard/README.md) 单独说明已发布版本与源码版本。

## 打开与分享

源码包是浏览器能呈现的 HTML；`data-persist` 和 `card` API 需要宿主运行时。
宿主导出的包还会携带标准 shim、状态快照和资源占位层，以提供独立打开行为。
单纯把未注入运行时的源码改名为 `.card.html` 不会自动安装运行时。

目录包压缩时，`index.html` 必须位于 ZIP 根层，不能多包一层目录。保留相对资产与
许可证，通过宿主导出当前状态后再分享。接收方导入为新的独立实体，不继承授权。
卡片关闭后不会继续执行，不要把持久保存描述成后台常驻运行。

需要重复使用的制作方法可以写成 [Recipe / Skill](../creator/README.zh.md)。
它与运行时协议分开；界面语言可以是作者定义的 state 字段，切换语言时不应翻译或
覆盖用户自己的便笺内容。
