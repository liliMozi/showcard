# showcard

交互卡片的开放规范：一张**魔术卡（showcard）**就是一个网页。

*[English](./README.md)*

## 从这里开始

这里是开发者项目：规范、参考实现、制作指南和一致性工具。营销官网单独维护；
`docs/` 保留示例与文档站镜像，不是开发者需要接入的应用主体。

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
示例会实际服务一个带 CSS 资产的目录包，使用浏览器持久状态，不包含 API Key。

```sh
npm run check:examples
npm run cli -- validate examples/host/card
npm run cli -- conformance --adapter ./examples/host/adapter.mjs
npm test
```

参考实现与可运行适配器覆盖 L1。生产授权（L2）、实体生命周期与导出（L3）以及可选扩展，
仍需要宿主进一步接入和验证；L1 通过不代表这些能力也已通过验证。

源码 CLI 为 0.9.2，单独发布的 npm 包可能落后。复现当前版本请使用上面的源码命令，
详见 [CLI 文档](packages/showcard/README.md)。

## 设计原则

**One Card。** 魔术卡是一个网页——比网页多一点，但和网页一样好写。它的入口是一份
完整的 HTML 文档，可以带任意数量的资产文件，组织方式与任何静态网站相同。最简单
时它就是一个单文件 `my-card.card.html`，任意浏览器双击即可打开、渲染、交互。把
同一个包交给实现本规范的宿主，它额外获得宿主以 web server 语义提供的服务、
持久状态、能力协商，以及受自身声明约束的工具调用。

- **One Card。** 不需要 SDK，不需要构建步骤，没有生命周期钩子，没有第二层要学的
  封装规则。会写网页，就会写魔术卡：入口是普通的 HTML 文档，资产是 `assets/`
  下的普通文件，引用是普通的相对路径。它需要的一切都在这个包里随它一起走。
- **能力留在宿主。** 运行时由宿主在服务它的那一刻注入；卡片只持有引用和请求的
  权利，凭据与执行力始终留在宿主侧。卡片经结构化插座能碰到什么，由一块静态
  声明块钉死；信任按授权分级——每项能力用前问一次、记住答案、随时可撤，跟卡片
  是否钉住无关。网络访问是唯一有意的例外：卡片可以像任何网页一样直接联网，
  受宿主按实例签发的 CSP 与一次运行时权限征询约束，宿主从不代理字节。钉住是
  另一回事，把卡片当刻状态拓印成一个常驻实体。
- **能跑，不是空谈。** 仓库自带一个一口气就能读完的参考宿主，以及一套第三方
  可以拿去测自己实现的一致性套件。

## 仓库结构

| 路径 | 装了什么 |
|------|---------|
| `spec/` | 规范正文。`1.0.en.md` 是 canonical，`1.0.md` 是与之并行维护的中文版 |
| `reference/` | 一个最小 L1 宿主垫层，纯 ES 模块——无构建步骤、无运行时依赖，两个文件就能把一个网页变成合法宿主 |
| `conformance/` | 第 9 章那些测试的可运行版本：卡片文件的静态检查、L0 无害性运行、注入层的糖等价矩阵，以及一套宿主探针 |
| `creator/` | 配方创建器：一份卡片技能（第 8 章），访谈用户并把答案做成一个配方包 |

## 实现

- **参考宿主垫层** —— 本仓库的 `reference/`，一致性等级 L1（状态宿主）。

实现 showcard 的宿主产品将列在这里。

## 官网

canonical 主页是 <https://showcard.org>，源码在
<https://github.com/liliMozi/showcard>。

## 许可

按文件的性质使用以下许可：

- 规范正文——`spec/` 下的全部内容——采用
  [CC BY 4.0](./LICENSE-SPEC)。
- 参考代码——`reference/`、`conformance/`、网站演示运行时及仓库自有代码——采用 [MIT 许可](./LICENSE-CODE)。
- `docs/examples/{weather,note,piano,todo}/` 中的 OpenHanako 配方派生代码采用 [Apache-2.0](./docs/examples/LICENSE-RECIPES)。长城插画另采用 CC BY-SA 3.0，来源、作者与改动见 [图片署名](./docs/examples/note/ARTWORK.md)。

## 跑测试

```
npm ci
npm test
```
