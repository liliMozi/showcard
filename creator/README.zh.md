# 配方创建器（Recipe Creator）

*[English](./README.md)*

**配方**是教 Agent 铸造某一类卡片的技能包（见规范第 8 章）。这个目录里
放的，是教 Agent 做配方的那份配方。

它是一个不带模板的包：一份 `SKILL.md` 加三份参考文档。profile 标记的是包，
不是包里的内容。

| 文件 | 内容 |
|------|------|
| `SKILL.md` | 五阶段访谈，以及收尾的质量闭环 |
| `references/binding-criteria.md` | 哪些候选动作能接到工具上，接不上的怎么办 |
| `references/three-hosts.md` | 把"在能力更弱的宿主上会怎样"问成卡片写得下来的行为 |
| `references/package-shape.md` | 目录、frontmatter、SKILL.md 章节，以及模板文件合法的条件 |

## 安装

把目录打包成名为 `recipe-creator.recipe` 的 zip，经宿主的安装通道装入。
`.skill` 是同一格式的兼容名。从没听说过配方的宿主会把它当普通 skill 读，
文本照样成立——那时它就是一份手写卡片包的指南，单文件或目录形态皆可。

frontmatter 里的 `default-enabled: false` 表示 Agent 自己装上的配方以关闭状态
到达，由 Agent 的主人决定开不开。
