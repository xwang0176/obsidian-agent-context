# Safety and Privacy

This document explains the safety and privacy model for Obsidian Agent Context.

## Local-first behavior

Obsidian Agent Context runs locally inside Obsidian.

The plugin does not upload files, notes, metadata, or generated indexes to any external service.

The plugin does not call an LLM API.

The plugin writes generated files inside the current vault under:

```text
.agent_context/
```

## What the plugin reads

The plugin reads files inside the current Obsidian vault.

It scans file paths, file names, folder paths, file extensions, file sizes, file timestamps, Markdown headings, Obsidian wikilinks, Markdown links, selected frontmatter fields, and tags.

It also detects references from Markdown notes to non-Markdown files such as PDFs, images, data files, and Office documents.

## What the plugin does not read

The plugin does not parse the content of PDFs, Word documents, Excel files, PowerPoint files, images, audio files, or video files.

These files are indexed by metadata and references only.

The plugin also does not read files outside the current Obsidian vault.

## Markdown content exposure

The plugin does not export full Markdown note content.

It only extracts selected metadata and structure, such as headings, links, frontmatter fields, tags, and file metadata.

This is intentional. The generated index is a navigation layer, not a full-text copy of the vault.

## Fenced code block protection

The plugin ignores fenced code blocks when extracting headings and links.

This reduces false positives from examples such as:

```text
[[Example Link]]
# Example Heading
```

If these appear inside a code block, they should not be treated as real vault structure.

## Safe pointer writing

The plugin may write `AGENTS.md` pointer files to help agents find the generated context.

Vault-level pointer:

```text
AGENTS.md
```

Folder-level pointer:

```text
<folder>/AGENTS.md
```

The plugin does not overwrite an existing `AGENTS.md`.

If an `AGENTS.md` already exists, the plugin writes:

```text
AGENTS.agent-context-indexer.md
```

This fallback file tells the user or agent that the existing file was not overwritten and can be merged manually if desired.

## Generated files

Generated files are written under:

```text
.agent_context/
```

For vault-level context:

```text
.agent_context/latest/
```

For folder-level context:

```text
.agent_context/folders/<folder_slug>/latest/
```

A folder registry may be written to:

```text
.agent_context/folder_context_registry.csv
```

These files are part of the user's vault and can be reviewed, deleted, ignored in Git, or excluded from sync if desired.

## Capped outputs

Some outputs are capped by design.

Capped outputs are recorded in `agent_context_manifest.json` and `large_index_notice.md`.

A capped output should not be treated as a complete list.

This is a safety and usability choice. It avoids generating overly large files that may be difficult for agents or users to review.

## Startup refresh behavior

The plugin can check whether generated indexes are stale when Obsidian starts.

Auto-refresh is off by default.

If enabled, auto-refresh may scan the vault or configured folders and write generated index files during startup. Users who prefer explicit control should keep auto-refresh disabled and run commands manually.

## Recommended Git behavior

Users may want to exclude generated context files from Git.

Example `.gitignore` entry:

```text
.agent_context/
```

Users may also choose to exclude generated pointer fallback files:

```text
AGENTS.agent-context-indexer.md
**/AGENTS.agent-context-indexer.md
```

Whether to commit `AGENTS.md` depends on the user's project workflow.

## Sensitive vaults

For vaults containing sensitive information, users should review generated files before sharing them with any agent or external system.

Even though the plugin does not export full note content, generated metadata can still reveal sensitive information through file names, folder names, headings, tags, frontmatter fields, and link targets.

## Agent usage guidance

Agents should treat the generated index as a navigation map.

Agents should not assume that capped outputs are complete.

Agents should not read large numbers of source files without first narrowing the task.

Agents should prefer manifest and summaries first, capped inventories second, and selected original files only when needed.

## Known limitations

- The plugin does not classify sensitive information.
- The plugin does not redact file names, headings, tags, or frontmatter.
- The plugin does not verify whether an external agent will handle files safely.
- The plugin does not parse binary files.
- The plugin does not prevent users from sharing generated files.

## Safety principles

The plugin follows these principles: local-first, no external network calls, metadata-first, no full-text dump by default, capped outputs, clear stale and cap notices, no overwrite of existing `AGENTS.md`, and user-controlled refresh behavior.
