# Obsidian Agent Context

Obsidian Agent Context is a local-first Obsidian plugin that generates an agent-readable context index for an Obsidian vault.

The goal is not to replace search, embeddings, or full-text reading. The goal is to give an AI agent a safe, structured, and low-noise map of the vault before it starts opening source files.

## What it is

Obsidian Agent Context creates a metadata-first index under `.agent_context/`. The generated index helps an agent understand what files exist, how notes are organized, which notes link to other notes, which notes reference attachments, which folders may be worth scanning separately, and whether generated outputs are capped or stale.

The plugin supports both vault-level indexing and folder-level indexing.

## What it is not

This plugin is not a semantic search engine, an embedding system, a full-text vault dump, an LLM summarizer, a PDF or Office parser, or a replacement for Obsidian search.

It intentionally avoids reading or exporting more content than necessary.

## Why this exists

Large Obsidian vaults can be difficult for agents to navigate. If an agent starts by reading random source files, it may miss the structure of the vault or spend context on irrelevant files.

This plugin creates a breadth-first map first. The agent can then choose a smaller number of files to read based on structured evidence.

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

## Vault-level vs folder-level context

Vault-level context provides a broad map of the full vault. It is useful for initial discovery.

Run:

```text
Generate Vault Agent Context
```

Folder-level context provides a lower-noise index for configured folders. Folder scopes are configured in plugin settings, one folder path per line:

```text
Projects/FrameAxis
Literature
Research/Papers
```

Run:

```text
Generate Configured Folder Contexts
```

Folder-level context is useful when the vault is large and the agent needs to focus on a specific project, literature area, or research folder.

## AGENTS.md pointer behavior

The plugin writes an `AGENTS.md` pointer so agents know where to start.

For vault-level context, the pointer is written at the vault root:

```text
AGENTS.md
```

For folder-level context, the pointer is written inside the configured folder:

```text
Projects/FrameAxis/AGENTS.md
```

The plugin does not overwrite an existing `AGENTS.md`.

If an `AGENTS.md` file already exists, the plugin writes a fallback file instead:

```text
AGENTS.agent-context-indexer.md
```

The fallback file explains that the existing `AGENTS.md` was not overwritten and can be merged manually if desired.

## Recommended agent workflow

Agents should start with `agent_context_manifest.json`.

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

## Settings

The plugin currently supports multiple configured folder scopes, staleness days, startup stale check, optional vault auto-refresh on startup, and optional configured folder auto-refresh on startup.

Auto-refresh is off by default because scanning and writing files during startup may not be desirable for every user.

## Limitations

- The plugin indexes non-Markdown files by metadata only.
- It does not parse PDFs, Office files, images, audio, or video.
- CSV outputs are capped to keep them readable.
- A capped output is not a complete dump.
- Folder-level context is scoped to files inside the configured folder, but note links may resolve to notes outside the folder.
- The plugin only scans files inside the current Obsidian vault.

## Roadmap

Possible future improvements include settings for custom caps, folder scope validation in settings, commands to open the latest manifest and folder context registry, optional run history, right-click folder indexing, better diagnostics, and package-ready release workflow.

## Design principles

The plugin follows these principles: local-first, metadata-first, breadth-first, capped by default, agent-readable, safe pointer writing, and vault-level map plus folder-level focused context.
