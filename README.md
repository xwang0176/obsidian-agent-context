# Obsidian Agent Context

**Local-first context indexing for AI agents working with Obsidian vaults.**

Obsidian Agent Context helps AI agents understand your vault before they start reading your notes. It generates a structured, local, token-efficient map of your vault so an agent can quickly decide where to look next.

Instead of asking an agent to open random files or read a large folder blindly, you can give it a lightweight context index first.

```text
vault or folder
→ local metadata-first scan
→ capped agent-readable index
→ agent reads the index
→ agent selectively opens source files
```

## Why use it?

AI agents are powerful, but they often waste context when they do not know the structure of your vault. A large Obsidian vault may contain years of notes, project folders, PDFs, images, data files, and old drafts. Without a map, an agent may read too much, read the wrong files, or miss the most important folders.

Obsidian Agent Context gives the agent a map first.

It helps the agent answer questions like:

- What folders and files exist in this vault?
- Which notes look central?
- Which notes link to each other?
- Which notes reference PDFs, images, or data files?
- Which folder should be scanned more deeply?
- Which source files are worth opening next?

## Key features

- **Local-first**: runs inside Obsidian and writes files locally to your vault
- **No token cost to generate indexes**: indexing does not call an LLM API
- **No LLM or embedding API calls**: no OpenAI, Anthropic, or other model provider is called by the plugin
- **Low-cost to try**: generate a local index, ask your agent if it helps, and delete it if it does not
- **Vault-level context**: generate a broad map of the full vault
- **Folder-level context**: generate focused indexes for selected subfolders
- **Multiple folder scopes**: configure several folders and generate all folder indexes at once
- **Safe `AGENTS.md` pointers**: creates agent entry-point files without overwriting existing ones
- **Metadata-first output**: indexes paths, headings, links, frontmatter, tags, file inventory, and attachment references
- **Capped outputs**: avoids huge files that are hard for agents to use
- **Agent-readable structure**: outputs Markdown, JSON, and CSV files designed for agent workflows

## Try it with almost no commitment

Obsidian Agent Context is designed to be easy to try.

Generating a local index does not consume tokens, does not call an LLM API, and does not upload your vault. The plugin only writes local Markdown, JSON, and CSV files under `.agent_context/`.

After generating the index, you can ask your agent:

```text
Read the generated Agent Context index. Does it help you understand this vault?
Which files would you read next?
Would this index reduce the number of source files you need to open?
Would this likely save tokens compared with reading the vault directly?
```

If the index is useful, you can keep it and optionally merge the generated `AGENTS.md` pointer into your workflow.

If it is not useful, there is little downside. You can ignore the generated pointer, avoid merging `AGENTS.agent-context-indexer.md`, or delete the generated files:

```text
.agent_context/
AGENTS.agent-context-indexer.md
```

This makes the plugin a low-risk way to test whether agent-readable context indexing helps your vault before committing to a larger workflow.

## Token and API usage

Generating the index does **not** consume tokens.

The plugin does not call an LLM API, does not create embeddings, and does not upload your vault. It only scans local vault metadata and writes local files under `.agent_context/`.

Token usage may happen later only if you choose to give the generated index files to an AI tool or agent.

## How it works

The plugin scans your vault or configured folders and creates a local context package.

It extracts:

- file paths
- folder structure
- file types and sizes
- Markdown headings
- Obsidian wikilinks
- Markdown links
- selected frontmatter fields
- tags
- references from notes to PDFs, images, data files, and other non-Markdown files

It does **not** export full note content by default. It is meant to help an agent navigate first, not to dump your entire vault.

## Generated output

Vault-level output is written to:

```text
.agent_context/latest/
```

Folder-level output is written to:

```text
.agent_context/folders/<folder_slug>/latest/
```

A folder context registry is written to:

```text
.agent_context/folder_context_registry.csv
```

Typical generated files include:

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

## Vault-level indexing

Vault-level indexing creates a broad map of the full vault.

Run:

```text
Generate Vault Agent Context
```

Output:

```text
.agent_context/latest/
```

Vault-level context is best for initial discovery. It helps an agent understand the overall shape of the vault before deciding whether a folder-level scan would be more useful.

## Folder-level indexing

Folder-level indexing creates focused indexes for selected folders.

In plugin settings, enter one folder path per line:

```text
Projects/FrameAxis
Literature
Research/Papers
```

Then run:

```text
Generate Configured Folder Contexts
```

Output example:

```text
.agent_context/folders/projects__frameaxis/latest/
.agent_context/folders/literature/latest/
.agent_context/folders/research__papers/latest/
```

Folder-level context is useful when the vault-level index is too broad or noisy. It lets the agent focus on a specific project, literature area, research folder, or working directory.

## Generate all contexts

To generate both the vault-level index and all configured folder-level indexes, run:

```text
Generate All Agent Contexts
```

This creates or updates:

```text
.agent_context/latest/
.agent_context/folders/<folder_slug>/latest/
.agent_context/folder_context_registry.csv
```

## Safe `AGENTS.md` pointers

The plugin writes pointer files so agents know where to start.

For vault-level context, the pointer is written at the vault root:

```text
AGENTS.md
```

For folder-level context, the pointer is written inside the configured folder:

```text
<folder>/AGENTS.md
```

The plugin does **not** overwrite an existing `AGENTS.md`.

If an `AGENTS.md` already exists, the plugin writes a fallback file instead:

```text
AGENTS.agent-context-indexer.md
```

The fallback file explains that the existing `AGENTS.md` was not overwritten and can be merged manually if desired.

## Recommended agent workflow

Agents should start with the manifest:

```text
.agent_context/latest/agent_context_manifest.json
```

For folder-level context:

```text
.agent_context/folders/<folder_slug>/latest/agent_context_manifest.json
```

Recommended order:

1. Read `agent_context_manifest.json`.
2. Read `directory_context.md`.
3. Read `large_index_notice.md`.
4. Read `folder_tree_summary.md`.
5. Read `file_inventory_summary.md`.
6. Read `inventory_group_counts.csv`.
7. Use `note_index.csv` and `markdown_outline.csv` to select relevant notes.
8. Use `note_link_graph.csv`, `backlink_summary.md`, and `frontmatter_index.csv` for note navigation.
9. Use `attachment_reference_graph.csv` for references to PDFs, images, data files, and other non-Markdown files.
10. Read original vault files only after selecting a small number of candidates.

## Example use case

Imagine you have a large research vault with folders like:

```text
Projects/
Literature/
Data/
Drafts/
Images/
Archive/
```

You want an agent to help with a project in `Projects/FrameAxis`, but you do not want it to read the entire vault.

With Obsidian Agent Context, you can:

1. Generate a vault-level context index.
2. Ask the agent which folder seems most relevant.
3. Generate a folder-level index for `Projects/FrameAxis`.
4. Let the agent inspect the folder-level manifest, note outlines, backlinks, and attachment references.
5. Only then let it open selected source notes or files.

This gives the agent more structure while reducing unnecessary reading.

## What the plugin does not do

This plugin is not:

- a semantic search engine
- an embedding system
- a full-text vault dump
- an LLM summarizer
- a PDF, Word, Excel, image, audio, or video parser
- a replacement for Obsidian search

Non-Markdown files are indexed by metadata and references only. Their contents are not parsed.

## Privacy and safety

Obsidian Agent Context is designed to be local-first.

- It does not upload vault data.
- It does not call any LLM provider.
- It does not scan files outside the current Obsidian vault.
- It does not overwrite existing `AGENTS.md` files.
- It does not export full Markdown note content by default.
- It records capped outputs so agents do not mistake partial indexes for complete dumps.

For more details, see [`SAFETY.md`](SAFETY.md).

## Design

The core design principles are:

- local-first
- metadata-first
- breadth-first
- capped by default
- agent-readable
- safe pointer writing
- vault-level map plus folder-level focused context

For more details, see [`DESIGN.md`](DESIGN.md).

## Related project: standalone Python version

A standalone Python version of this idea is also available or planned for non-Obsidian use cases, such as indexing local project folders, research folders, code repositories, and document directories.

The Obsidian plugin does **not** require the Python version. The Python version is a related standalone tool for users who want Agent Context Indexing outside Obsidian.

## Suggested `.gitignore`

Generated context files usually should not be committed to a vault repository unless you intentionally want to share them.

Example:

```gitignore
.agent_context/
AGENTS.agent-context-indexer.md
**/AGENTS.agent-context-indexer.md
```

Whether to commit `AGENTS.md` depends on your workflow.

## Limitations

- Generated CSV files are capped.
- Capped outputs are not complete dumps.
- Non-Markdown files are not parsed.
- Folder-level scans only include files inside the configured folder, although links may resolve to targets outside the folder.
- Metadata such as file names, headings, tags, and frontmatter may still reveal sensitive information.
- Users should review generated files before sharing them with external tools.

## Roadmap

Possible future improvements:

- settings for custom caps
- folder scope validation in settings
- command to open the latest manifest
- command to open the folder context registry
- optional timestamped run history under `.agent_context/runs/`
- right-click folder action for folder-level indexing
- better reporting for broken and ambiguous links
- optional ignored folders
- public beta and release packaging

## Status

This project is in early MVP development. It is usable locally, but the format and generated outputs may change as the plugin is tested on more vaults.
