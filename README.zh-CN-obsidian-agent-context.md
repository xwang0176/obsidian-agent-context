# Obsidian Agent Context 中文说明

[English README](README.md)

**在 AI agent 读取笔记之前，先给它一张 Obsidian vault 的本地地图。**

Obsidian Agent Context 是一个 Obsidian 插件。它可以为你的 vault 或指定 folder 生成 **本地、零 token 成本、agent 可读的上下文索引**，帮助 AI agent 快速理解：

- 这个 vault 里有什么
- 哪些 folder 可能相关
- 哪些 note 比较重要
- 下一步应该优先打开哪些文件
- 是否可以避免读取大量无关内容

它不会调用 LLM，不会生成 embedding，也不会上传你的 vault。它只是生成一个本地的 `.agent_context/` 文件夹。

```text
生成本地索引 → 让 agent 判断是否有帮助 → 有用就保留或合并指引文件
```

## 为什么使用它？

AI agent 在理解 workspace 结构之后，通常会更有效。

如果没有一个预先的地图，agent 可能会打开错误的 note、忽略重要 folder，或者浪费 token 读取不相关的文件。Obsidian Agent Context 的作用就是先提供一个轻量的 orientation layer，让 agent 在真正读取源文件之前先了解整体结构。

它的目标很简单：

> 减少盲目读取，提高上下文选择质量，并在后续使用 AI agent 时节省 token。

## 为什么试用成本很低？

生成索引本身几乎没有成本：

- 本地运行在 Obsidian 内
- 不调用任何 LLM API
- 不消耗 token
- 不上传 vault
- 不覆盖已有的 `AGENTS.md`
- 生成的 `.agent_context/` 可以随时删除

生成索引后，你可以问 agent：

```text
请先读取 Agent Context index。

这个索引是否有助于你理解我的 vault？
你会优先打开哪些文件？
这是否能减少你需要读取的源文件数量？
相比直接读取 vault，这是否可能节省 token？
```

如果 agent 觉得有帮助，就继续使用。  
如果没有帮助，删除 `.agent_context/`，并忽略或删除生成的 pointer 文件即可。

## 它不做什么？

Obsidian Agent Context 不是一个重型 AI 插件。

它不会：

- 上传你的笔记
- 调用 OpenAI、Anthropic 或其他模型服务
- 生成 embedding
- 用 LLM 总结你的 vault
- 解析 PDF、Word、Excel、图片、音频或视频内容
- 替代 Obsidian search
- 把整个 vault 导出成一个巨大的全文 dump

它的定位是：

> 本地导航层，而不是 semantic search engine 或 summarizer。

## 快速开始

安装并启用插件后，打开 Obsidian command palette：

```text
Ctrl + P
```

搜索：

```text
Agent Context
```

你应该会看到三个命令：

```text
Generate vault agent context
Generate configured folder contexts
Generate all agent contexts
```

它们分别用于：

- **Generate vault agent context**：生成整个 vault 的索引，输出到 `.agent_context/latest/`
- **Generate configured folder contexts**：为 settings 里配置的 folder 生成 folder-level 索引
- **Generate all agent contexts**：同时生成 vault-level 和 folder-level 索引

## 典型使用方式

基本流程是三步：

```text
1. 生成本地索引
2. 问 agent 这个索引是否有帮助
3. 如果有帮助，保留或合并生成的 AGENTS pointer
```

### 方式 1：扫描整个 vault

适合你想先获得一个 vault 的整体地图。

运行：

```text
Generate vault agent context
```

生成：

```text
.agent_context/latest/
```

然后问 agent：

```text
请先读取 vault-level Agent Context index。

这个索引是否帮助你理解我的 vault 结构？
哪些 folder 或 note 看起来最相关？
这是否能减少你需要打开的源文件数量？
对于这个任务，folder-level scan 会不会更有用？
```

注意：对于非常大的 vault，全局扫描可能仍然比较宽泛。这时 vault-level scan 更适合作为第一张地图，用来判断下一步应该扫描哪个 folder。

### 方式 2：扫描一个或多个指定 folder

适合你已经知道想让 agent 关注哪个项目、研究方向或 folder。

在插件 settings 里，每行输入一个相对路径，例如：

```text
Projects/Project_ABC
Literature
Research/Papers
```

路径应当是相对于 vault root 的路径。比如你的 vault 是：

```text
E:\obsidian-vault
```

目标 folder 是：

```text
E:\obsidian-vault\Projects\Project_ABC
```

那么 settings 里应该填写：

```text
Projects/Project_ABC
```

然后运行：

```text
Generate configured folder contexts
```

生成的 folder-level index 类似：

```text
.agent_context/folders/projects__project_ABC/latest/
.agent_context/folders/literature/latest/
.agent_context/folders/research__papers/latest/
```

然后问 agent：

```text
请读取 Projects/Project_ABC 的 folder-level Agent Context index。

这个索引是否足够帮助你理解这个项目？
相比直接读取整个 folder，这是否能节省 token？
```

通常，当任务比较聚焦时，folder-level scan 会比整个 vault scan 更有用，因为它更小、更干净、噪音更少。

### 方式 3：同时扫描 vault 和配置的 folders

适合你既想要全局地图，也想要几个重点 folder 的细分地图。

运行：

```text
Generate all agent contexts
```

生成或更新：

```text
.agent_context/latest/
.agent_context/folders/<folder_slug>/latest/
.agent_context/folder_context_registry.csv
```

然后问 agent：

```text
请读取 vault-level Agent Context index 和 folder context registry。

哪些 folder-level indexes 对当前任务有帮助？
哪些生成的 context 文件值得保留？
哪些似乎不必要？
是否应该把某些生成的 AGENTS pointer 合并到我已有的 agent instructions 里？
```

## 和 Python 版本的关系

这个 Obsidian 插件专门用于 Obsidian vault。

如果你想扫描普通本地文件夹，比如代码仓库、研究文件夹、数据项目或混合文档目录，可以使用 standalone Python 版本：

[Agent Context Indexer](https://github.com/xwang0176/agent-context-indexer)

Obsidian 插件不需要 Python 版本。它们只是共享同一个核心想法：

> Agent Context Indexing：在 agent 深度读取文件之前，先生成一个本地、低成本、可导航的上下文地图。

---

# 详细说明

## 插件会生成什么？

Vault-level 输出位置：

```text
.agent_context/latest/
```

Folder-level 输出位置：

```text
.agent_context/folders/<folder_slug>/latest/
```

Folder context registry：

```text
.agent_context/folder_context_registry.csv
```

典型输出文件包括：

```text
agent_context_manifest.json
directory_context.md
large_index_notice.md
folder_tree_summary.md
file_inventory_summary.md
inventory_group_counts.csv

inventory_markdown.csv
inventory_code.csv
inventory_data.csv
inventory_documents_sample.csv
inventory_media_sample.csv
inventory_other_sample.csv

note_index.csv
markdown_outline.csv
markdown_outline_summary.md

note_link_graph.csv
note_link_graph_summary.md
backlink_summary.md

frontmatter_index.csv
frontmatter_index_summary.md

attachment_reference_graph.csv
attachment_reference_summary.md
```

## 它如何工作？

插件会扫描 vault 或配置的 folder，并提取结构性 metadata，例如：

- 文件路径
- folder 结构
- 文件类型和大小
- Markdown headings
- Obsidian wikilinks
- Markdown links
- selected frontmatter fields
- tags
- note 对 PDF、图片、数据文件等非 Markdown 文件的引用

它会在提取 headings 和 links 前移除 fenced code blocks，所以代码块里的例子不会被当成真实 vault 结构。

## AGENTS.md pointer 安全机制

插件会生成 pointer 文件，告诉 agent 应该从哪里开始读取 index。

Vault-level context 的 pointer 写在 vault root：

```text
AGENTS.md
```

Folder-level context 的 pointer 写在对应 folder 内：

```text
<folder>/AGENTS.md
```

插件不会覆盖已有的 `AGENTS.md`。

如果 `AGENTS.md` 已经存在，它会改为生成：

```text
AGENTS.agent-context-indexer.md
```

之后你可以手动决定是否把这部分内容合并到已有 `AGENTS.md`。

## 推荐 agent 读取顺序

建议 agent 从 manifest 开始：

```text
.agent_context/latest/agent_context_manifest.json
```

Folder-level context 则从这里开始：

```text
.agent_context/folders/<folder_slug>/latest/agent_context_manifest.json
```

推荐顺序：

1. `agent_context_manifest.json`
2. `directory_context.md`
3. `large_index_notice.md`
4. `folder_tree_summary.md`
5. `file_inventory_summary.md`
6. `inventory_group_counts.csv`
7. `note_index.csv` 和 `markdown_outline.csv`
8. `note_link_graph.csv`、`backlink_summary.md`、`frontmatter_index.csv`
9. `attachment_reference_graph.csv`
10. 最后只读取少量真正相关的源文件

## 隐私与安全

Obsidian Agent Context 是 local-first 插件。

- 不上传 vault 数据
- 不调用任何 LLM provider
- 不扫描当前 Obsidian vault 之外的文件
- 不覆盖已有 `AGENTS.md`
- 默认不导出完整 Markdown note 内容
- 使用 capped outputs，避免 agent 把局部索引误认为完整 dump

但生成的 index 仍可能包含文件名、folder 名、headings、tags、frontmatter 等 metadata。分享给外部工具或他人之前，请先检查生成内容。

更多细节可以看：

- [`SAFETY.md`](SAFETY.md)
- [`DESIGN.md`](DESIGN.md)

## 建议的 `.gitignore`

一般不建议把生成的 context 文件提交到 vault repo，除非你明确想共享它们。

```gitignore
.agent_context/
AGENTS.agent-context-indexer.md
**/AGENTS.agent-context-indexer.md
```

是否提交 `AGENTS.md` 取决于你的 workflow。

## 当前限制

- 生成的 CSV 文件会 capped
- capped outputs 不是完整 dump
- 非 Markdown 文件不会被解析
- Folder-level scan 只包含配置 folder 内的文件，但 links 可能指向 folder 外部
- 文件名、headings、tags、frontmatter 仍可能包含敏感信息

## 项目状态

当前项目处于 early MVP / beta 阶段。它已经可以本地使用，但 output 格式可能会随着更多 vault 测试继续调整。
