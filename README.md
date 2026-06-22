![Status](https://img.shields.io/badge/status-MVP-blue)
![Local First](https://img.shields.io/badge/local--first-yes-green)
![No LLM Calls](https://img.shields.io/badge/LLM%20calls-none-lightgrey)
![Token Cost](https://img.shields.io/badge/indexing%20token%20cost-zero-green)

# Obsidian Agent Context

**Give AI agents a map of your Obsidian vault before they start reading your notes.**

Obsidian Agent Context generates a **local, token-free, agent-readable index** of your vault so an AI agent can quickly understand what exists, where to look, and which files are worth opening next.

No LLM calls. No embeddings. No upload. Just a local context map.

```text
Generate local index → Ask your agent if it helps → Keep it, merge it, or delete it
```

## Why use it?

AI agents are much more useful when they know the structure of your workspace.

Without a map, an agent may open the wrong notes, miss important project folders, or spend tokens reading files that are not relevant. Obsidian Agent Context gives the agent a lightweight orientation layer first.

It helps an agent answer:

- What is in this vault?
- Which folders look relevant?
- Which notes are central?
- Which files should I read next?
- Can I avoid opening unnecessary source files?

The goal is simple: **less blind reading, better context selection, and lower token waste when you later use an AI agent.**

## Why it is low-risk to try

Generating the index itself costs almost nothing.

- It runs locally inside Obsidian.
- It does not call an LLM API.
- It does not consume tokens.
- It does not upload your vault.
- It does not overwrite existing `AGENTS.md` files.
- It writes removable files under `.agent_context/`.

After generating the index, you can ask your agent:

```text
Read the Agent Context index. Does this help you understand my vault?
Which files would you open next?
Would this reduce the number of source files you need to read?
Would this likely save tokens compared with reading the vault directly?
```

If the answer is yes, keep using it.

If the answer is no, delete `.agent_context/` and ignore or delete the generated pointer file. No workflow lock-in.

## What it does NOT do

Obsidian Agent Context is intentionally NOT another heavy AI layer.

It does NOT:

- upload your notes
- call OpenAI, Anthropic, or any other model provider
- generate embeddings
- summarize your vault with an LLM
- parse PDFs, Word files, Excel files, images, audio, or video
- replace Obsidian search
- export your full vault as one giant text dump

It is a **navigation layer**, not a semantic search engine or summarizer.

## Example use cases

Obsidian Agent Context is useful when you want an agent to understand your vault before it starts reading source files.

The basic workflow has three steps:

```text
1. Generate a local index
2. Ask your agent whether the index is useful
3. If useful, merge or keep the generated AGENTS pointer
```

After installing and enabling the plugin, open the Obsidian command palette with `Ctrl + P` and search for **Agent Context**.

You should see three commands:

```text
Generate vault agent context
Generate configured folder contexts
Generate all agent contexts
```

Use them as follows:

- **Generate vault agent context**: creates a vault-level index under `.agent_context/latest/`.
- **Generate configured folder contexts**: creates folder-level indexes for the folders configured in plugin settings.
- **Generate all agent contexts**: generates both the vault-level index and all configured folder-level indexes.


### Option 1: Scan the whole vault

Use this when you want a broad first map of the vault.

Run:

```text
Generate vault agent context
```

This creates:

```text
.agent_context/latest/
```

Then ask your agent:

```text
Read the vault-level Agent Context index first.

Does this help you understand the overall structure of my vault?
Which folders or notes look most relevant?
Would this reduce the number of source files you need to open?
Would a folder-level scan be more useful for this task?
```

This is a good first step for discovery. The caveat is that for very large vaults, a full-vault index may still be broad or noisy. In that case, the vault-level scan is best used as a map to decide which folder should be scanned next.

### Option 2: Scan one or more specific folders

Use this when you already know the project, research area, or folder you want the agent to focus on.

In plugin settings, enter one folder path per line:

```text
Projects/Project_ABC
Literature
Research/Papers
```

Folder paths should be relative to the vault root. For example, if your vault is:

```text
E:\obsidian-vault
```

and the folder is:

```text
E:\obsidian-vault\Projects\Project_ABC
```

then enter:

```text
Projects/Project_ABC
```

Then run:

```text
Generate configured folder contexts
```

This creates folder-specific context indexes such as:

```text
.agent_context/folders/projects__project_ABC/latest/
.agent_context/folders/literature/latest/
.agent_context/folders/research__papers/latest/
```

Then ask your agent:

```text
Read the folder-level Agent Context index for Projects/Project_ABC.

Does this give you enough context to work on this project?
Would this folder-level index save tokens compared with reading the folder directly?
```

Folder-level scans are usually more useful when the task is focused, because they reduce noise and give the agent a smaller, more relevant context map.

### Option 3: Scan the vault and configured folders together

Use this when you want both a global map and focused folder maps.

Run:

```text
Generate all agent contexts
```

This creates or updates:

```text
.agent_context/latest/
.agent_context/folders/<folder_slug>/latest/
.agent_context/folder_context_registry.csv
```

Then ask your agent:

```text
Read the vault-level Agent Context index and the folder context registry.
Would this folder-level index save tokens compared with reading the folder directly?
```

This option combines broad discovery with focused context. It is useful when you want the agent to compare the vault-level map with several folder-level maps and tell you which ones are actually helpful.

### After scanning: decide whether to keep or merge

If the generated context is helpful, you can keep using it and optionally merge the generated `AGENTS.md` or `AGENTS.agent-context-indexer.md` pointer into your own agent instructions.

If it is not helpful, you can simply delete:

```text
.agent_context/
AGENTS.agent-context-indexer.md
```

or ignore the generated pointer. The scan itself did not consume tokens and did not upload your vault.


## Related project: standalone Python version

The Obsidian plugin is designed for Obsidian vaults.

A standalone Python version of the same idea is also available or planned for non-Obsidian use cases, such as local project folders, research folders, code repositories, and document directories.

The Obsidian plugin does **not** require the Python version. They are related tools built around the same idea: **Agent Context Indexing**.

---

# Details

The sections below describe how the plugin works, what it generates, and how agents should use the output.

## How it works

The plugin scans your vault or configured folders and creates a local context package.

It extracts metadata and structure such as:

- file paths
- folder structure
- file types and sizes
- Markdown headings
- Obsidian wikilinks
- Markdown links
- selected frontmatter fields
- tags
- references from notes to PDFs, images, data files, and other non-Markdown files

It removes fenced code blocks before extracting headings and links, so examples inside code blocks are not treated as real vault structure.

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

## Privacy and safety

Obsidian Agent Context is designed to be local-first.

- It does not upload vault data.
- It does not call any LLM provider.
- It does not scan files outside the current Obsidian vault.
- It does not overwrite existing `AGENTS.md` files.
- It does not export full Markdown note content by default.
- It records capped outputs so agents do not mistake partial indexes for complete dumps.

For more details, see [`SAFETY.md`](SAFETY.md).

## Design principles

The core design principles are:

- local-first
- metadata-first
- breadth-first
- capped by default
- agent-readable
- safe pointer writing
- vault-level map plus folder-level focused context

For more details, see [`DESIGN.md`](DESIGN.md).

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
