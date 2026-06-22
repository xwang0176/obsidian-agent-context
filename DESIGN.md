# Design

This document explains the design of Obsidian Agent Context.

## Core idea

Obsidian Agent Context creates a structured context layer between an Obsidian vault and an AI agent.

The plugin does not try to summarize the vault or replace search. Instead, it creates an agent-readable map that helps an agent decide where to look next.

The main pattern is:

```text
vault or folder
metadata-first scan
capped index files
AGENTS pointer
agent reads index first
agent selectively opens source files
```

## Design goals

The main goals are:

1. Help agents navigate a vault without reading random files first.
2. Keep generated outputs small enough to be useful in an agent context window.
3. Avoid exporting full note content by default.
4. Support both full-vault discovery and focused folder-level discovery.
5. Avoid overwriting user-authored instruction files.
6. Make stale or capped indexes explicit.

## Non-goals

The plugin is not designed to be a semantic search engine, embedding database, LLM summarization tool, full-text vault exporter, binary file parser, or replacement for Obsidian native search.

## Scope model

The plugin supports two scope types.

### Vault scope

Vault scope scans the whole vault, excluding generated files and Obsidian plugin files.

Output:

```text
.agent_context/latest/
```

Vault-level context is the broad map.

### Folder scope

Folder scope scans a configured folder inside the vault.

Output:

```text
.agent_context/folders/<folder_slug>/latest/
```

Folder-level context is the focused map.

Multiple folder scopes can be configured in settings, one folder path per line.

## Output layout

Vault-level output:

```text
.agent_context/latest/
```

Folder-level output:

```text
.agent_context/folders/<folder_slug>/latest/
```

Folder registry:

```text
.agent_context/folder_context_registry.csv
```

The registry records configured folder indexes so a vault-level agent can discover existing folder-level contexts.

## Index files

### Manifest

`agent_context_manifest.json` is the entry point for each generated context. It records tool version, generation time, scope, output location, caps, counts, output file names, pointer behavior, and the recommended agent workflow.

### Directory context

`directory_context.md` gives a human-readable overview of the generated context, including scope information, counts, top file categories, top extensions, recommended workflow, and limitations.

### File inventory

File inventory outputs describe files by metadata only. They include group counts, summary files, and capped category inventories for Markdown, code, data, documents, media, and other files.

### Markdown outline

`markdown_outline.csv` records headings from Markdown notes. It includes path, basename, folder, heading level, heading text, and line number. It ignores fenced code blocks.

This gives agents a structural preview without exporting full note content.

### Note link graph

`note_link_graph.csv` records note-to-note wikilinks. It includes source note, raw target, resolved target path, target existence, resolution method, and whether the target is inside the current scope.

This helps agents identify valid links, broken links, ambiguous links, and links that leave a folder scope.

### Backlink summary

`backlink_summary.md` summarizes incoming and outgoing link patterns. It helps identify high-incoming notes, high-outgoing notes, potential hub notes, broken links, and ambiguous links.

### Frontmatter index

`frontmatter_index.csv` records selected frontmatter fields and tags. It is meant for navigation, not full frontmatter preservation.

### Attachment reference graph

`attachment_reference_graph.csv` records references from Markdown notes to non-Markdown files. It includes target existence, resolution method, target extension, reference type, and whether the target is inside the current scope.

The plugin does not parse attachment content.

### Folder tree summary

`folder_tree_summary.md` gives a capped folder-level overview. It is designed for quick orientation, not full listing.

### Large index notice

`large_index_notice.md` explains whether any outputs were capped. This prevents an agent from assuming the index is complete when it is only a sample.

## Link resolution

The plugin resolves note links against Markdown files and attachment links against all vault files.

Resolution methods include `exact_path`, `unique_name`, `unique_basename`, `unique_filename`, `multiple_name_matches`, `multiple_basename_matches`, `multiple_filename_matches`, and `not_found`.

The output records whether a target exists and, for folder-level scans, whether the target is within the current scope.

## Fenced code block handling

The plugin removes fenced code blocks before extracting wikilinks, Markdown links, attachment references, and headings.

This avoids treating examples inside code blocks as real vault references.

## Capping strategy

Generated CSV files are capped to avoid producing very large files. Caps are recorded in `agent_context_manifest.json` and `large_index_notice.md`.

The agent should treat capped outputs as navigation samples, not complete lists.

## AGENTS pointer design

The plugin writes pointer files so agents know where to begin.

Vault-level pointer:

```text
AGENTS.md
```

Folder-level pointer:

```text
<folder>/AGENTS.md
```

The plugin never overwrites an existing `AGENTS.md`. If a primary pointer already exists, it writes `AGENTS.agent-context-indexer.md`.

## Refresh design

The plugin uses a simple global refresh model with staleness days, startup stale check, optional vault auto-refresh, and optional configured folder auto-refresh.

Per-folder refresh settings are intentionally not included in the first version because they add complexity. A later version could support per-folder overrides.

## Why folder-level context matters

Vault-level context is useful for discovery, but large vaults can still be noisy. Folder-level context lets the user or agent focus on a project, research area, or literature folder.

The intended workflow is:

```text
root scan for map
folder scan for focus
source files for evidence
```

## Privacy model

The plugin runs locally inside Obsidian. It does not call an LLM API and does not upload vault data. The generated index stays inside the vault unless the user chooses to share it.

## Future design directions

Possible future additions include folder scope validation, configurable caps, right-click folder scan, open manifest command, open registry command, run history, ignored folders, and improved link diagnostics.
