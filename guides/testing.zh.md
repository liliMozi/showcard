# 验证你的实现

[English](testing.md) · [宿主接入指南](host-integration.zh.md)

## 复现项目检查

```sh
npm ci
npm test
npm run check:examples
npm run cli -- conformance
npm run cli -- conformance --adapter ./examples/host/adapter.mjs
```

最后一条命令使用完整的适配器工厂示例，其测试对象是 jsdom 中的参考宿主。
它演示目录包挂载与清理，不会替一个无关的 Agent 自动取得兼容证明。
验证自己的实现时，把工厂换成挂载**你的宿主**的适配器，再传给 `--adapter`。

## 适配器契约

模块默认导出工厂，返回包含 `mount(cardSource, cardId)` 的对象。source 可以是完整 HTML
字符串，或 `{ entry, files }` 目录包，其中 files 是相对路径到字节或文本的 Map。挂载返回：

| 成员 | 含义 |
| --- | --- |
| `getDocument()` | 卡片正在运行的 Document，不是外层宿主页 |
| `remount()` | 用同一实体 ID 重新打开相同源码，保留状态存储 |
| `unmount()` | 销毁这次挂载和相关资源 |
| 适配器 `close()`，可选 | 套件结束后关闭共用服务器或浏览器会话 |

通过测试框架获取卡片 DOM，不能为了方便测试而放宽生产 iframe 的隔离策略。
测试专用 `conformance.echo` 绑定返回 `{echo: input}`，必须与生产工具网关隔离。
其他探针约定见[套件契约](../conformance/README.md)。

## 正确理解结果

```text
host.l1: pass
host.l2: not-automated
host.l3: not-automated
```

`pass` 表示自动断言实际执行并通过；`not-automated` 表示这部分职责没有被自动评估，
既不是通过，也不是失败。静态检查也不等于运行时安全或视觉正确。

声明生产可用前，应另测拒绝与撤销授权、未声明工具和网络主机、按实体隔离状态、
消息来源窗口校验、导入不继承授权、导出包含当刻状态与资产，以及关闭时释放资源。
还应在真实浏览器中检查布局、键盘与触摸、声音和承诺的独立打开行为。测试夹具不放真实凭据。

把 `card.state`、可选的宿主数据和静默活动日志分开。不能为了通过能力检查而把未实现的
扩展声明为可用。更换运行时注入层、分发器或包服务边界后，重新验证。
