# showcard

交互卡片的开放规范：一张**魔术卡（showcard）**就是一个网页。

*[English](./README.md)*

## 从这里开始

这里包含规范、参考实现、制作指南和一致性工具。

| 你的目标 | 入口 |
| --- | --- |
| 制作一张交互卡片 | [卡片制作指南](guides/card-authoring.zh.md) |
| 让自己的 Agent 支持 Showcard | [宿主接入指南](guides/host-integration.zh.md) |
| 验证自己的实现 | [测试与适配器指南](guides/testing.zh.md) |
| 教 Agent 重复制作某类卡片 | [Recipe Creator](creator/README.zh.md) |
| 阅读规范性契约 | [规范 1.0](spec/1.0.md) |

## 运行完整示例

开发环境需要 Node.js 22.13+ 或 24+。

```sh
git clone https://github.com/liliMozi/showcard.git
cd showcard
npm ci
npm run demo
```

打开服务打印的本地地址。修改便笺后刷新，确认状态保留；调用已声明的时间工具，查看返回值。
示例会实际服务一个带 CSS 资产的目录包，并使用浏览器持久状态。

```sh
npm run check:examples
npm run cli -- validate examples/host/card
npm run cli -- conformance --adapter ./examples/host/adapter.mjs
npm test
```

参考实现与参考适配器覆盖 L1。生产授权（L2）、实体生命周期与导出（L3）以及可选扩展，
仍需要宿主进一步接入和验证；L1 通过不代表这些能力也已通过验证。

源码命令和适配器用法见 [CLI 文档](packages/showcard/README.md)。

## 仓库结构

| 路径 | 装了什么 |
|------|---------|
| `spec/` | 中英文规范正文 |
| `reference/` | 纯 ES 模块的最小 L1 宿主垫层 |
| `conformance/` | 第 9 章的测试：卡片文件的静态检查、L0 无害性运行、注入层的糖等价矩阵，以及一套宿主探针 |
| `creator/` | 配方创建器：一份卡片技能（第 8 章），访谈用户并把答案做成一个配方包 |

## 许可

- 规范：[CC BY 4.0](LICENSE-SPEC)。
- 代码：[MIT](LICENSE-CODE)。
- 示例与素材：[署名与许可](docs/credits.html)。
