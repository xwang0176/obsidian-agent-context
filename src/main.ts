import {
  App,
  CachedMetadata,
  Notice,
  Plugin,
  PluginSettingTab,
  Setting,
  TFile,
  normalizePath,
} from "obsidian";

type CsvRow = Record<string, string>;

type ResolvedTarget = {
  target_exists: string;
  resolved_target_path: string;
  target_resolution_method: string;
};

type CapRecord = {
  output: string;
  total_rows: number;
  indexed_rows: number;
  cap: number;
};

type AgentContextScope = {
  scope_type: "vault" | "folder";
  scope_path: string;
  scope_slug: string;
  output_dir: string;
};

type ScopeResult = {
  scope_type: string;
  scope_path: string;
  scope_slug: string;
  agent_context_location: string;
  generated_at: string;
  total_files: number;
  markdown_notes: number;
  capped_outputs: number;
};

interface ObsidianAgentContextSettings {
  folderScopePaths: string;
  stalenessDays: number;
  autoCheckOnStartup: boolean;
  autoRefreshVaultOnStartup: boolean;
  autoRefreshFoldersOnStartup: boolean;
}

const DEFAULT_SETTINGS: ObsidianAgentContextSettings = {
  folderScopePaths: "",
  stalenessDays: 7,
  autoCheckOnStartup: true,
  autoRefreshVaultOnStartup: false,
  autoRefreshFoldersOnStartup: false,
};

const MAX_NOTE_INDEX_ROWS = 1000;
const MAX_MARKDOWN_OUTLINE_ROWS = 2000;
const MAX_LINK_ROWS = 2000;
const MAX_FRONTMATTER_ROWS = 1000;
const MAX_INVENTORY_ROWS_PER_CATEGORY = 500;
const MAX_ATTACHMENT_REFERENCE_ROWS = 2000;
const MAX_FOLDER_TREE_ROWS = 300;
const MAX_FOLDER_TREE_DEPTH = 3;

export default class ObsidianAgentContextPlugin extends Plugin {
  settings: ObsidianAgentContextSettings = DEFAULT_SETTINGS;

  async onload(): Promise<void> {
    await this.loadSettings();
    this.addSettingTab(new ObsidianAgentContextSettingTab(this.app, this));

    this.addCommand({
      id: "generate-vault-agent-context",
      name: "Generate vault agent context",
      callback: async () => {
        try {
          await this.generateAgentContext(this.buildVaultScope());
          new Notice("Vault agent context generated.");
        } catch {
          new Notice("Failed to generate vault agent context.");
        }
      },
    });

    this.addCommand({
      id: "generate-configured-folder-contexts",
      name: "Generate configured folder contexts",
      callback: async () => {
        try {
          const results = await this.generateConfiguredFolderContexts();
          new Notice(`Generated ${String(results.length)} folder agent context indexes.`);
        } catch {
          new Notice("Failed to generate folder agent context indexes.");
        }
      },
    });

    this.addCommand({
      id: "generate-all-agent-contexts",
      name: "Generate all agent contexts",
      callback: async () => {
        try {
          await this.generateAgentContext(this.buildVaultScope());
          const results = await this.generateConfiguredFolderContexts();
          new Notice(
            `Generated vault context and ${String(results.length)} folder context indexes.`
          );
        } catch {
          new Notice("Failed to generate all agent context indexes.");
        }
      },
    });

    if (this.settings.autoCheckOnStartup) {
      window.setTimeout(() => {
        void this.checkStalenessOnStartup();
      }, 2000);
    }
  }

  async checkStalenessOnStartup(): Promise<void> {
    const vaultScope = this.buildVaultScope();
    const vaultStatus = await this.getManifestStaleness(vaultScope.output_dir);

    if (vaultStatus === "missing") {
      new Notice("Vault agent context is missing. Run generate vault agent context.");
    } else if (vaultStatus === "stale") {
      if (this.settings.autoRefreshVaultOnStartup) {
        await this.generateAgentContext(vaultScope);
        new Notice("Refreshed stale vault agent context.");
      } else {
        new Notice("Vault agent context may be stale. Run generate vault agent context.");
      }
    }

    const folderScopes = this.getConfiguredFolderScopes();

    if (folderScopes.length === 0) {
      return;
    }

    const staleOrMissingFolders: AgentContextScope[] = [];

    for (const scope of folderScopes) {
      const status = await this.getManifestStaleness(scope.output_dir);

      if (status === "missing" || status === "stale") {
        staleOrMissingFolders.push(scope);
      }
    }

    if (staleOrMissingFolders.length === 0) {
      return;
    }

    if (this.settings.autoRefreshFoldersOnStartup) {
      const results: ScopeResult[] = [];

      for (const scope of staleOrMissingFolders) {
        results.push(await this.generateAgentContext(scope));
      }

      await this.writeFolderContextRegistry(results);
      new Notice(`Refreshed ${String(results.length)} stale folder agent context indexes.`);
    } else {
      new Notice(
        `${String(
          staleOrMissingFolders.length
        )} configured folder agent context indexes may be stale or missing.`
      );
    }
  }

  async getManifestStaleness(outputDir: string): Promise<"fresh" | "stale" | "missing"> {
    const manifestPath = normalizePath(`${outputDir}/agent_context_manifest.json`);
    const exists = await this.app.vault.adapter.exists(manifestPath);

    if (!exists) {
      return "missing";
    }

    try {
      const raw = await this.app.vault.adapter.read(manifestPath);
      const parsed: unknown = JSON.parse(raw);

      if (!this.isRecord(parsed)) {
        return "stale";
      }

      const generatedAtValue = parsed["generated_at"];

      if (typeof generatedAtValue !== "string") {
        return "stale";
      }

      const generatedAt = new Date(generatedAtValue);
      const ageMs = Date.now() - generatedAt.getTime();
      const staleMs = this.settings.stalenessDays * 24 * 60 * 60 * 1000;

      if (!Number.isFinite(ageMs) || ageMs > staleMs) {
        return "stale";
      }

      return "fresh";
    } catch {
      return "stale";
    }
  }

  async generateConfiguredFolderContexts(): Promise<ScopeResult[]> {
    const scopes = this.getConfiguredFolderScopes();

    if (scopes.length === 0) {
      new Notice("No folder scopes configured. Add one folder path per line in plugin settings.");
      return [];
    }

    const results: ScopeResult[] = [];

    for (const scope of scopes) {
      const folderExists = await this.app.vault.adapter.exists(scope.scope_path);

      if (!folderExists) {
        new Notice(`Folder scope not found: ${scope.scope_path}`);
        continue;
      }

      results.push(await this.generateAgentContext(scope));
    }

    await this.writeFolderContextRegistry(results);
    return results;
  }

  buildVaultScope(): AgentContextScope {
    return {
      scope_type: "vault",
      scope_path: "",
      scope_slug: "vault",
      output_dir: normalizePath(".agent_context/latest"),
    };
  }

  getConfiguredFolderScopes(): AgentContextScope[] {
    const lines = this.settings.folderScopePaths
      .split(/\r?\n/)
      .map((line) => normalizePath(line.trim()))
      .filter((line) => line.length > 0)
      .filter((line) => !line.startsWith(".agent_context/"))
      .filter((line) => !line.startsWith(`${this.app.vault.configDir}/`));

    const uniqueLines = Array.from(new Set(lines));

    return uniqueLines.map((folderPath) => {
      const slug = this.slugifyScopePath(folderPath);

      return {
        scope_type: "folder",
        scope_path: folderPath,
        scope_slug: slug,
        output_dir: normalizePath(`.agent_context/folders/${slug}/latest`),
      };
    });
  }

  slugifyScopePath(path: string): string {
    const slug = normalizePath(path)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "__")
      .replace(/^_+|_+$/g, "");

    return slug || "folder";
  }

  async generateAgentContext(scope: AgentContextScope): Promise<ScopeResult> {
    const vaultName = this.app.vault.getName();
    const outputDir = scope.output_dir;

    const manifestPath = normalizePath(`${outputDir}/agent_context_manifest.json`);
    const directoryContextPath = normalizePath(`${outputDir}/directory_context.md`);

    const inventoryGroupCountsPath = normalizePath(`${outputDir}/inventory_group_counts.csv`);
    const inventoryMarkdownPath = normalizePath(`${outputDir}/inventory_markdown.csv`);
    const inventoryCodePath = normalizePath(`${outputDir}/inventory_code.csv`);
    const inventoryDataPath = normalizePath(`${outputDir}/inventory_data.csv`);
    const inventoryDocumentsPath = normalizePath(`${outputDir}/inventory_documents_sample.csv`);
    const inventoryMediaPath = normalizePath(`${outputDir}/inventory_media_sample.csv`);
    const inventoryOtherPath = normalizePath(`${outputDir}/inventory_other_sample.csv`);
    const inventorySummaryPath = normalizePath(`${outputDir}/file_inventory_summary.md`);

    const noteIndexPath = normalizePath(`${outputDir}/note_index.csv`);
    const markdownOutlinePath = normalizePath(`${outputDir}/markdown_outline.csv`);
    const markdownOutlineSummaryPath = normalizePath(`${outputDir}/markdown_outline_summary.md`);

    const noteLinkGraphPath = normalizePath(`${outputDir}/note_link_graph.csv`);
    const noteLinkGraphSummaryPath = normalizePath(`${outputDir}/note_link_graph_summary.md`);
    const backlinkSummaryPath = normalizePath(`${outputDir}/backlink_summary.md`);

    const frontmatterIndexPath = normalizePath(`${outputDir}/frontmatter_index.csv`);
    const frontmatterSummaryPath = normalizePath(`${outputDir}/frontmatter_index_summary.md`);

    const attachmentReferenceGraphPath = normalizePath(`${outputDir}/attachment_reference_graph.csv`);
    const attachmentReferenceSummaryPath = normalizePath(`${outputDir}/attachment_reference_summary.md`);

    const folderTreeSummaryPath = normalizePath(`${outputDir}/folder_tree_summary.md`);
    const largeIndexNoticePath = normalizePath(`${outputDir}/large_index_notice.md`);

    const pointerPaths = this.getPointerPathsForScope(scope);

    await this.ensureFolder(outputDir);

    const now = new Date().toISOString();

    const allVaultFiles = this.app.vault
      .getFiles()
      .filter((file) => !this.isGeneratedOrPluginFile(file))
      .sort((a, b) => a.path.localeCompare(b.path));

    const allFiles = allVaultFiles.filter((file) => this.isInScope(file, scope));
    const markdownFiles = allFiles.filter((file) => file.extension.toLowerCase() === "md");

    const allVaultMarkdownFiles = allVaultFiles.filter(
      (file) => file.extension.toLowerCase() === "md"
    );

    const allVaultFilePathSet = new Set(allVaultFiles.map((file) => normalizePath(file.path)));
    const allVaultFilesByName = this.buildFilesByNameMap(allVaultFiles);
    const allVaultMarkdownPathSet = new Set(
      allVaultMarkdownFiles.map((file) => normalizePath(file.path))
    );
    const allVaultMarkdownByName = this.buildFilesByNameMap(allVaultMarkdownFiles);

    const capRecords: CapRecord[] = [];

    const inventoryRows = this.buildFileInventoryRows(allFiles);
    const inventoryGroupCountsCsv = this.buildInventoryGroupCountsCsv(inventoryRows);
    const inventorySummary = this.buildFileInventorySummary(vaultName, now, scope, inventoryRows);

    const markdownInventoryRows = this.limitRowsWithCapRecord(
      inventoryRows.filter((row) => row["file_category"] === "markdown_note"),
      MAX_INVENTORY_ROWS_PER_CATEGORY,
      "inventory_markdown.csv",
      capRecords
    );
    const codeInventoryRows = this.limitRowsWithCapRecord(
      inventoryRows.filter((row) => row["file_category"] === "code"),
      MAX_INVENTORY_ROWS_PER_CATEGORY,
      "inventory_code.csv",
      capRecords
    );
    const dataInventoryRows = this.limitRowsWithCapRecord(
      inventoryRows.filter((row) => row["file_category"] === "data"),
      MAX_INVENTORY_ROWS_PER_CATEGORY,
      "inventory_data.csv",
      capRecords
    );
    const documentInventoryRows = this.limitRowsWithCapRecord(
      inventoryRows.filter((row) => row["file_category"] === "document"),
      MAX_INVENTORY_ROWS_PER_CATEGORY,
      "inventory_documents_sample.csv",
      capRecords
    );
    const mediaInventoryRows = this.limitRowsWithCapRecord(
      inventoryRows.filter((row) => row["file_category"] === "media"),
      MAX_INVENTORY_ROWS_PER_CATEGORY,
      "inventory_media_sample.csv",
      capRecords
    );
    const otherInventoryRows = this.limitRowsWithCapRecord(
      inventoryRows.filter((row) => row["file_category"] === "other"),
      MAX_INVENTORY_ROWS_PER_CATEGORY,
      "inventory_other_sample.csv",
      capRecords
    );

    const noteIndexFiles = this.limitRowsWithCapRecord(
      markdownFiles,
      MAX_NOTE_INDEX_ROWS,
      "note_index.csv",
      capRecords
    );
    const noteIndexCsv = this.buildNoteIndexCsv(noteIndexFiles);

    const allMarkdownOutlineRows = await this.buildMarkdownOutlineRows(markdownFiles);
    const markdownOutlineRows = this.limitRowsWithCapRecord(
      allMarkdownOutlineRows,
      MAX_MARKDOWN_OUTLINE_ROWS,
      "markdown_outline.csv",
      capRecords
    );
    const markdownOutlineCsv = this.buildMarkdownOutlineCsv(markdownOutlineRows);
    const markdownOutlineSummary = this.buildMarkdownOutlineSummary(
      vaultName,
      now,
      scope,
      allMarkdownOutlineRows,
      markdownOutlineRows
    );

    const allLinkRows = await this.buildNoteLinkRows(
      markdownFiles,
      allVaultMarkdownPathSet,
      allVaultMarkdownByName,
      scope
    );
    const linkRows = this.limitRowsWithCapRecord(
      allLinkRows,
      MAX_LINK_ROWS,
      "note_link_graph.csv",
      capRecords
    );
    const noteLinkGraphCsv = this.buildNoteLinkGraphCsv(linkRows);
    const noteLinkGraphSummary = this.buildNoteLinkGraphSummary(
      vaultName,
      now,
      scope,
      allLinkRows,
      linkRows
    );
    const backlinkSummary = this.buildBacklinkSummary(vaultName, now, scope, allLinkRows);

    const allFrontmatterRows = this.buildFrontmatterRows(markdownFiles);
    const frontmatterRows = this.limitRowsWithCapRecord(
      allFrontmatterRows,
      MAX_FRONTMATTER_ROWS,
      "frontmatter_index.csv",
      capRecords
    );
    const frontmatterIndexCsv = this.buildFrontmatterIndexCsv(frontmatterRows);
    const frontmatterSummary = this.buildFrontmatterSummary(
      vaultName,
      now,
      scope,
      allFrontmatterRows,
      frontmatterRows
    );

    const allAttachmentRows = await this.buildAttachmentReferenceRows(
      markdownFiles,
      allVaultFilePathSet,
      allVaultFilesByName,
      scope
    );
    const attachmentRows = this.limitRowsWithCapRecord(
      allAttachmentRows,
      MAX_ATTACHMENT_REFERENCE_ROWS,
      "attachment_reference_graph.csv",
      capRecords
    );
    const attachmentReferenceGraphCsv = this.buildAttachmentReferenceGraphCsv(attachmentRows);
    const attachmentReferenceSummary = this.buildAttachmentReferenceSummary(
      vaultName,
      now,
      scope,
      allAttachmentRows,
      attachmentRows
    );

    const folderTreeSummary = this.buildFolderTreeSummary(vaultName, now, scope, allFiles);
    const largeIndexNotice = this.buildLargeIndexNotice(vaultName, now, scope, capRecords);

    const frontmatterNotes = allFrontmatterRows.filter(
      (row) => row["has_frontmatter"] === "true"
    ).length;
    const taggedNotes = allFrontmatterRows.filter((row) => (row["tags"] ?? "") !== "").length;
    const existingAttachmentReferences = allAttachmentRows.filter(
      (row) => row["target_exists"] === "true"
    ).length;
    const missingAttachmentReferences = allAttachmentRows.filter(
      (row) => row["target_exists"] === "false"
    ).length;
    const ambiguousAttachmentReferences = allAttachmentRows.filter(
      (row) => row["target_exists"] === "ambiguous"
    ).length;
    const resolvedNoteLinks = allLinkRows.filter((row) => row["target_exists"] === "true").length;
    const missingNoteLinks = allLinkRows.filter((row) => row["target_exists"] === "false").length;
    const ambiguousNoteLinks = allLinkRows.filter(
      (row) => row["target_exists"] === "ambiguous"
    ).length;

    const agentPointerStatus = await this.writeSafeAgentPointer(
      pointerPaths.primary,
      pointerPaths.fallback,
      this.buildAgentPointerContent(scope)
    );

    const manifest = {
      tool_name: "Obsidian Agent Context",
      version: "0.1.0",
      generated_at: now,
      vault_name: vaultName,
      scope_type: scope.scope_type,
      scope_path: scope.scope_path,
      scope_slug: scope.scope_slug,
      agent_context_location: outputDir,
      agent_pointer: agentPointerStatus,
      design_principles: [
        "local-first",
        "breadth-first",
        "metadata-first",
        "capped outputs",
        "agent-readable",
        "avoid large single files",
        "safe pointer writing",
      ],
      caps: {
        max_note_index_rows: MAX_NOTE_INDEX_ROWS,
        max_markdown_outline_rows: MAX_MARKDOWN_OUTLINE_ROWS,
        max_note_link_rows: MAX_LINK_ROWS,
        max_frontmatter_rows: MAX_FRONTMATTER_ROWS,
        max_inventory_rows_per_category: MAX_INVENTORY_ROWS_PER_CATEGORY,
        max_attachment_reference_rows: MAX_ATTACHMENT_REFERENCE_ROWS,
        max_folder_tree_rows: MAX_FOLDER_TREE_ROWS,
        max_folder_tree_depth: MAX_FOLDER_TREE_DEPTH,
      },
      cap_records: capRecords,
      counts: {
        total_files: allFiles.length,
        markdown_notes_total: markdownFiles.length,
        markdown_notes_indexed: noteIndexFiles.length,

        inventory_rows_total: inventoryRows.length,

        markdown_outline_rows_total: allMarkdownOutlineRows.length,
        markdown_outline_rows_indexed: markdownOutlineRows.length,

        note_links_total: allLinkRows.length,
        note_links_indexed: linkRows.length,
        note_links_resolved_targets: resolvedNoteLinks,
        note_links_missing_targets: missingNoteLinks,
        note_links_ambiguous_targets: ambiguousNoteLinks,

        frontmatter_notes: frontmatterNotes,
        tagged_notes: taggedNotes,
        frontmatter_rows_total: allFrontmatterRows.length,
        frontmatter_rows_indexed: frontmatterRows.length,

        attachment_references_total: allAttachmentRows.length,
        attachment_references_indexed: attachmentRows.length,
        attachment_references_existing_targets: existingAttachmentReferences,
        attachment_references_missing_targets: missingAttachmentReferences,
        attachment_references_ambiguous_targets: ambiguousAttachmentReferences,
      },
      outputs: {
        manifest: "agent_context_manifest.json",
        directory_context: "directory_context.md",

        inventory_group_counts: "inventory_group_counts.csv",
        file_inventory_summary: "file_inventory_summary.md",
        inventory_markdown: "inventory_markdown.csv",
        inventory_code: "inventory_code.csv",
        inventory_data: "inventory_data.csv",
        inventory_documents_sample: "inventory_documents_sample.csv",
        inventory_media_sample: "inventory_media_sample.csv",
        inventory_other_sample: "inventory_other_sample.csv",

        note_index: "note_index.csv",
        markdown_outline: "markdown_outline.csv",
        markdown_outline_summary: "markdown_outline_summary.md",

        note_link_graph: "note_link_graph.csv",
        note_link_graph_summary: "note_link_graph_summary.md",
        backlink_summary: "backlink_summary.md",

        frontmatter_index: "frontmatter_index.csv",
        frontmatter_index_summary: "frontmatter_index_summary.md",

        attachment_reference_graph: "attachment_reference_graph.csv",
        attachment_reference_summary: "attachment_reference_summary.md",

        folder_tree_summary: "folder_tree_summary.md",
        large_index_notice: "large_index_notice.md",
      },
      folder_context_registry:
        scope.scope_type === "vault" ? ".agent_context/folder_context_registry.csv" : "",
      staleness_policy: {
        staleness_days: this.settings.stalenessDays,
        refresh_cadence: this.settings.stalenessDays <= 1 ? "daily" : "custom",
      },
      agent_bootstrap_instruction:
        "Read agent_context_manifest.json first. Start with directory_context.md, large_index_notice.md, folder_tree_summary.md, file_inventory_summary.md, and inventory_group_counts.csv before opening detailed CSV files. Use capped inventories for breadth-first navigation, then read original source files only when needed.",
    };

    const directoryContext = this.buildDirectoryContext(
      vaultName,
      now,
      scope,
      allFiles,
      markdownFiles,
      inventoryRows,
      allLinkRows,
      allFrontmatterRows,
      allAttachmentRows,
      allMarkdownOutlineRows,
      capRecords
    );

    await this.app.vault.adapter.write(manifestPath, JSON.stringify(manifest, null, 2));
    await this.app.vault.adapter.write(directoryContextPath, directoryContext);

    await this.app.vault.adapter.write(inventoryGroupCountsPath, inventoryGroupCountsCsv);
    await this.app.vault.adapter.write(inventorySummaryPath, inventorySummary);
    await this.app.vault.adapter.write(
      inventoryMarkdownPath,
      this.buildGenericCsv(markdownInventoryRows, this.inventoryHeader())
    );
    await this.app.vault.adapter.write(
      inventoryCodePath,
      this.buildGenericCsv(codeInventoryRows, this.inventoryHeader())
    );
    await this.app.vault.adapter.write(
      inventoryDataPath,
      this.buildGenericCsv(dataInventoryRows, this.inventoryHeader())
    );
    await this.app.vault.adapter.write(
      inventoryDocumentsPath,
      this.buildGenericCsv(documentInventoryRows, this.inventoryHeader())
    );
    await this.app.vault.adapter.write(
      inventoryMediaPath,
      this.buildGenericCsv(mediaInventoryRows, this.inventoryHeader())
    );
    await this.app.vault.adapter.write(
      inventoryOtherPath,
      this.buildGenericCsv(otherInventoryRows, this.inventoryHeader())
    );

    await this.app.vault.adapter.write(noteIndexPath, noteIndexCsv);
    await this.app.vault.adapter.write(markdownOutlinePath, markdownOutlineCsv);
    await this.app.vault.adapter.write(markdownOutlineSummaryPath, markdownOutlineSummary);

    await this.app.vault.adapter.write(noteLinkGraphPath, noteLinkGraphCsv);
    await this.app.vault.adapter.write(noteLinkGraphSummaryPath, noteLinkGraphSummary);
    await this.app.vault.adapter.write(backlinkSummaryPath, backlinkSummary);

    await this.app.vault.adapter.write(frontmatterIndexPath, frontmatterIndexCsv);
    await this.app.vault.adapter.write(frontmatterSummaryPath, frontmatterSummary);

    await this.app.vault.adapter.write(attachmentReferenceGraphPath, attachmentReferenceGraphCsv);
    await this.app.vault.adapter.write(attachmentReferenceSummaryPath, attachmentReferenceSummary);

    await this.app.vault.adapter.write(folderTreeSummaryPath, folderTreeSummary);
    await this.app.vault.adapter.write(largeIndexNoticePath, largeIndexNotice);

    return {
      scope_type: scope.scope_type,
      scope_path: scope.scope_path,
      scope_slug: scope.scope_slug,
      agent_context_location: outputDir,
      generated_at: now,
      total_files: allFiles.length,
      markdown_notes: markdownFiles.length,
      capped_outputs: capRecords.length,
    };
  }

  getPointerPathsForScope(scope: AgentContextScope): { primary: string; fallback: string } {
    if (scope.scope_type === "vault") {
      return {
        primary: normalizePath("AGENTS.md"),
        fallback: normalizePath("AGENTS.agent-context-indexer.md"),
      };
    }

    return {
      primary: normalizePath(`${scope.scope_path}/AGENTS.md`),
      fallback: normalizePath(`${scope.scope_path}/AGENTS.agent-context-indexer.md`),
    };
  }

  isInScope(file: TFile, scope: AgentContextScope): boolean {
    if (scope.scope_type === "vault") {
      return true;
    }

    const filePath = normalizePath(file.path);
    const folderPath = normalizePath(scope.scope_path);

    return filePath.startsWith(`${folderPath}/`);
  }

  isGeneratedOrPluginFile(file: TFile): boolean {
    return (
      file.path.startsWith(".agent_context/") ||
      file.path.startsWith(`${this.app.vault.configDir}/`)
    );
  }

  buildDirectoryContext(
    vaultName: string,
    generatedAt: string,
    scope: AgentContextScope,
    allFiles: TFile[],
    markdownFiles: TFile[],
    inventoryRows: CsvRow[],
    linkRows: CsvRow[],
    frontmatterRows: CsvRow[],
    attachmentRows: CsvRow[],
    markdownOutlineRows: CsvRow[],
    capRecords: CapRecord[]
  ): string {
    const categoryCounts = this.countByField(inventoryRows, "file_category");
    const extensionCounts = this.countByField(inventoryRows, "extension");

    const existingAttachmentReferences = attachmentRows.filter(
      (row) => row["target_exists"] === "true"
    ).length;
    const missingAttachmentReferences = attachmentRows.filter(
      (row) => row["target_exists"] === "false"
    ).length;
    const existingNoteLinks = linkRows.filter((row) => row["target_exists"] === "true").length;
    const missingNoteLinks = linkRows.filter((row) => row["target_exists"] === "false").length;

    return `# Agent Context for ${vaultName}

Generated at: ${generatedAt}

## Scope

- Scope type: ${scope.scope_type}
- Scope path: ${scope.scope_path || "(vault root)"}
- Agent context location: ${scope.output_dir}

## Purpose

This folder contains a breadth-first, metadata-first index for helping an AI agent navigate this Obsidian vault or folder scope.

The index is intentionally capped. It is not a full dump of the vault.

## Summary

- Total files in scope: ${String(allFiles.length)}
- Markdown notes in scope: ${String(markdownFiles.length)}
- Markdown headings in scope: ${String(markdownOutlineRows.length)}
- Wikilinks found in scoped notes: ${String(linkRows.length)}
- Wikilinks with existing targets: ${String(existingNoteLinks)}
- Wikilinks with missing targets: ${String(missingNoteLinks)}
- Frontmatter rows: ${String(frontmatterRows.length)}
- Non-Markdown references from scoped notes: ${String(attachmentRows.length)}
- Non-Markdown references with existing targets: ${String(existingAttachmentReferences)}
- Non-Markdown references with missing targets: ${String(missingAttachmentReferences)}
- Capped outputs: ${String(capRecords.length)}

## File categories

${this.formatTopCounts(categoryCounts, 20)}

## Top extensions

${this.formatTopCounts(extensionCounts, 20)}

## Recommended agent workflow

1. Read agent_context_manifest.json first.
2. Read this directory_context.md.
3. Read large_index_notice.md to understand whether any outputs are capped.
4. Read folder_tree_summary.md, file_inventory_summary.md, and inventory_group_counts.csv.
5. Use category-specific inventory files only as needed.
6. Use note_index.csv and markdown_outline.csv to choose relevant notes.
7. Use note_link_graph.csv, backlink_summary.md, and frontmatter_index.csv for note navigation.
8. Use attachment_reference_graph.csv to understand references from notes to PDFs, images, data files, and other non-Markdown files.
9. Prefer rows where target_exists is true before trying to read original files.
10. Read original source files only after selecting a small number of relevant candidates.

## Important limitation

This plugin indexes non-Markdown files by metadata only. It does not parse PDF, Word, Excel, image, audio, or video content.

## Folder-level context

Vault-level context lives under:

\`.agent_context/latest/\`

Folder-level contexts, if configured, live under:

\`.agent_context/folders/<folder_slug>/latest/\`

A registry of configured folder contexts may be available at:

\`.agent_context/folder_context_registry.csv\`
`;
  }

  async writeFolderContextRegistry(results: ScopeResult[]): Promise<void> {
    const registryPath = normalizePath(".agent_context/folder_context_registry.csv");
    await this.ensureFolder(".agent_context");

    const existingRows = await this.readExistingFolderRegistry(registryPath);
    const nextRowsByScope = new Map<string, CsvRow>();

    for (const row of existingRows) {
      const scopePath = row["scope_path"] ?? "";

      if (scopePath.length > 0) {
        nextRowsByScope.set(scopePath, row);
      }
    }

    for (const result of results) {
      if (result.scope_type !== "folder") {
        continue;
      }

      nextRowsByScope.set(result.scope_path, {
        scope_path: result.scope_path,
        scope_slug: result.scope_slug,
        agent_context_location: result.agent_context_location,
        generated_at: result.generated_at,
        total_files: String(result.total_files),
        markdown_notes: String(result.markdown_notes),
        capped_outputs: String(result.capped_outputs),
      });
    }

    const header = [
      "scope_path",
      "scope_slug",
      "agent_context_location",
      "generated_at",
      "total_files",
      "markdown_notes",
      "capped_outputs",
    ];

    const rows = Array.from(nextRowsByScope.values()).sort((a, b) =>
      (a["scope_path"] ?? "").localeCompare(b["scope_path"] ?? "")
    );

    await this.app.vault.adapter.write(registryPath, this.buildGenericCsv(rows, header));
  }

  async readExistingFolderRegistry(registryPath: string): Promise<CsvRow[]> {
    const exists = await this.app.vault.adapter.exists(registryPath);

    if (!exists) {
      return [];
    }

    try {
      const content = await this.app.vault.adapter.read(registryPath);
      return this.parseSimpleCsv(content);
    } catch {
      return [];
    }
  }

  parseSimpleCsv(content: string): CsvRow[] {
    const lines = content.split(/\r?\n/).filter((line) => line.trim().length > 0);

    if (lines.length <= 1) {
      return [];
    }

    const headerLine = lines.at(0);

    if (headerLine === undefined) {
      return [];
    }

    const header = this.parseCsvLine(headerLine);
    const rows: CsvRow[] = [];

    for (const line of lines.slice(1)) {
      const values = this.parseCsvLine(line);
      const row: CsvRow = {};

      for (let index = 0; index < header.length; index++) {
        const key = header.at(index);

        if (key !== undefined) {
          row[key] = values.at(index) ?? "";
        }
      }

      rows.push(row);
    }

    return rows;
  }

  parseCsvLine(line: string): string[] {
    const result: string[] = [];
    let current = "";
    let insideQuotes = false;

    for (let index = 0; index < line.length; index++) {
      const char = line[index] ?? "";
      const next = line[index + 1];

      if (char === '"' && insideQuotes && next === '"') {
        current += '"';
        index += 1;
        continue;
      }

      if (char === '"') {
        insideQuotes = !insideQuotes;
        continue;
      }

      if (char === "," && !insideQuotes) {
        result.push(current);
        current = "";
        continue;
      }

      current += char;
    }

    result.push(current);
    return result;
  }

  buildFileInventoryRows(files: TFile[]): CsvRow[] {
    return files.map((file) => {
      const extension = file.extension.toLowerCase();
      const folder = file.parent?.path ?? "";

      return {
        path: file.path,
        name: file.name,
        basename: file.basename,
        folder,
        extension,
        size: String(file.stat.size),
        created_time: new Date(file.stat.ctime).toISOString(),
        modified_time: new Date(file.stat.mtime).toISOString(),
        file_category: this.classifyFile(extension),
      };
    });
  }

  classifyFile(extension: string): string {
    const markdown = new Set(["md", "markdown"]);
    const code = new Set([
      "py",
      "js",
      "ts",
      "jsx",
      "tsx",
      "html",
      "css",
      "scss",
      "sql",
      "r",
      "java",
      "kt",
      "c",
      "cpp",
      "h",
      "hpp",
      "cs",
      "go",
      "rs",
      "sh",
      "bat",
      "ps1",
      "m",
      "scala",
      "swift",
    ]);
    const data = new Set([
      "csv",
      "tsv",
      "json",
      "jsonl",
      "yaml",
      "yml",
      "xml",
      "parquet",
      "feather",
      "sqlite",
      "db",
      "pkl",
    ]);
    const document = new Set([
      "pdf",
      "doc",
      "docx",
      "ppt",
      "pptx",
      "xls",
      "xlsx",
      "rtf",
      "txt",
    ]);
    const media = new Set([
      "png",
      "jpg",
      "jpeg",
      "gif",
      "svg",
      "webp",
      "mp3",
      "wav",
      "mp4",
      "mov",
      "avi",
      "mkv",
    ]);

    if (markdown.has(extension)) return "markdown_note";
    if (code.has(extension)) return "code";
    if (data.has(extension)) return "data";
    if (document.has(extension)) return "document";
    if (media.has(extension)) return "media";
    return "other";
  }

  inventoryHeader(): string[] {
    return [
      "path",
      "name",
      "basename",
      "folder",
      "extension",
      "size",
      "created_time",
      "modified_time",
      "file_category",
    ];
  }

  buildInventoryGroupCountsCsv(rows: CsvRow[]): string {
    const header = ["group_type", "group_value", "file_count", "total_size_bytes"];
    const groupMap = new Map<string, { count: number; size: number }>();

    for (const row of rows) {
      const categoryKey = `file_category::${row["file_category"] ?? ""}`;
      const extensionKey = `extension::${row["extension"] || "(none)"}`;
      const folderKey = `folder::${row["folder"] || "(root)"}`;
      const size = Number(row["size"] || "0");

      for (const key of [categoryKey, extensionKey, folderKey]) {
        const current = groupMap.get(key) ?? { count: 0, size: 0 };
        current.count += 1;
        current.size += size;
        groupMap.set(key, current);
      }
    }

    const csvRows = Array.from(groupMap.entries())
      .map(([key, value]) => {
        const [groupType = "", groupValue = ""] = key.split("::");

        return {
          group_type: groupType,
          group_value: groupValue,
          file_count: String(value.count),
          total_size_bytes: String(value.size),
        };
      })
      .sort((a, b) =>
        a.group_type === b.group_type
          ? Number(b.file_count) - Number(a.file_count)
          : a.group_type.localeCompare(b.group_type)
      );

    return this.buildGenericCsv(csvRows, header);
  }

  buildFileInventorySummary(
    vaultName: string,
    generatedAt: string,
    scope: AgentContextScope,
    rows: CsvRow[]
  ): string {
    const categoryCounts = this.countByField(rows, "file_category");
    const extensionCounts = this.countByField(rows, "extension");
    const folderCounts = this.countByField(rows, "folder");

    return `# File Inventory Summary

Vault: ${vaultName}

Generated at: ${generatedAt}

Scope type: ${scope.scope_type}

Scope path: ${scope.scope_path || "(vault root)"}

## Summary

- Total indexed files in scope: ${String(rows.length)}
- Inventory files are split by category and capped to avoid large single files.
- Non-Markdown files are indexed by metadata only.

## File categories

${this.formatTopCounts(categoryCounts, 20)}

## Top extensions

${this.formatTopCounts(extensionCounts, 30)}

## Top folders

${this.formatTopCounts(folderCounts, 30)}

## Inventory files

- inventory_group_counts.csv: aggregated counts by category, extension, and folder
- inventory_markdown.csv: capped Markdown file inventory
- inventory_code.csv: capped code file inventory
- inventory_data.csv: capped data file inventory
- inventory_documents_sample.csv: capped document inventory
- inventory_media_sample.csv: capped media inventory
- inventory_other_sample.csv: capped other file inventory
`;
  }

  buildNoteIndexCsv(files: TFile[]): string {
    const header = [
      "path",
      "name",
      "basename",
      "folder",
      "extension",
      "size",
      "created_time",
      "modified_time",
    ];

    const rows = files.map((file) => {
      return {
        path: file.path,
        name: file.name,
        basename: file.basename,
        folder: file.parent?.path ?? "",
        extension: file.extension,
        size: String(file.stat.size),
        created_time: new Date(file.stat.ctime).toISOString(),
        modified_time: new Date(file.stat.mtime).toISOString(),
      };
    });

    return this.buildGenericCsv(rows, header);
  }

  async buildMarkdownOutlineRows(files: TFile[]): Promise<CsvRow[]> {
    const rows: CsvRow[] = [];

    for (const file of files) {
      const content = await this.app.vault.cachedRead(file);
      const lines = content.split(/\r?\n/);
      let insideFence = false;

      for (let index = 0; index < lines.length; index++) {
        const line = lines[index] ?? "";

        if (line.trim().startsWith("```")) {
          insideFence = !insideFence;
          continue;
        }

        if (insideFence) continue;

        const match = /^(#{1,6})\s+(.+?)\s*$/.exec(line);
        const marker = match?.[1] ?? "";
        const text = match?.[2] ?? "";

        if (marker.length === 0 || text.length === 0) continue;

        rows.push({
          path: file.path,
          basename: file.basename,
          folder: file.parent?.path ?? "",
          heading_level: String(marker.length),
          heading_text: text.trim(),
          line_number: String(index + 1),
        });
      }
    }

    return rows;
  }

  buildMarkdownOutlineCsv(rows: CsvRow[]): string {
    const header = [
      "path",
      "basename",
      "folder",
      "heading_level",
      "heading_text",
      "line_number",
    ];
    return this.buildGenericCsv(rows, header);
  }

  buildMarkdownOutlineSummary(
    vaultName: string,
    generatedAt: string,
    scope: AgentContextScope,
    allRows: CsvRow[],
    indexedRows: CsvRow[]
  ): string {
    const noteCounts = this.countByField(allRows, "path");
    const levelCounts = this.countByField(allRows, "heading_level");

    return `# Markdown Outline Summary

Vault: ${vaultName}

Generated at: ${generatedAt}

Scope type: ${scope.scope_type}

Scope path: ${scope.scope_path || "(vault root)"}

## Summary

- Total headings found: ${String(allRows.length)}
- Rows written to CSV: ${String(indexedRows.length)}
- Notes with headings: ${String(noteCounts.size)}
- CSV capped: ${indexedRows.length < allRows.length ? "true" : "false"}

## Heading levels

${this.formatTopCounts(levelCounts, 10)}

## Top notes by heading count

${this.formatTopCounts(noteCounts, 20)}

## Notes

This file extracts Markdown headings only.

It does not include full note content. It is intended to help agents understand note structure before opening original files.
`;
  }

  async buildNoteLinkRows(
    files: TFile[],
    markdownPathSet: Set<string>,
    markdownByName: Map<string, string[]>,
    scope: AgentContextScope
  ): Promise<CsvRow[]> {
    const rows: CsvRow[] = [];

    for (const file of files) {
      const content = await this.app.vault.cachedRead(file);
      const cleanedContent = this.removeFencedCodeBlocks(content);

      const wikiLinkRegex = /\[\[([^\]]+)\]\]/g;
      let match: RegExpExecArray | null;

      while ((match = wikiLinkRegex.exec(cleanedContent)) !== null) {
        const rawTarget = (match[1] ?? "").trim();
        if (!rawTarget) continue;

        const [targetPart = "", aliasPart = ""] = rawTarget.split("|");
        const target = targetPart.trim();
        const linkText = aliasPart.trim() || target;
        const resolved = this.resolveMarkdownTargetPath(
          target,
          markdownPathSet,
          markdownByName
        );

        rows.push({
          source_path: file.path,
          source_basename: file.basename,
          target_raw: target,
          target_note_guess: this.cleanNoteTarget(target),
          resolved_target_path: resolved.resolved_target_path,
          target_exists: resolved.target_exists,
          target_resolution_method: resolved.target_resolution_method,
          target_within_scope: this.isResolvedPathInScope(resolved.resolved_target_path, scope),
          link_text: linkText,
        });
      }
    }

    return rows;
  }

  resolveMarkdownTargetPath(
    target: string,
    markdownPathSet: Set<string>,
    markdownByName: Map<string, string[]>
  ): ResolvedTarget {
    const cleanTarget = this.cleanNoteTarget(target);
    const normalized = normalizePath(cleanTarget);
    const normalizedWithMd = normalized.toLowerCase().endsWith(".md")
      ? normalized
      : `${normalized}.md`;

    if (markdownPathSet.has(normalizedWithMd)) {
      return {
        target_exists: "true",
        resolved_target_path: normalizedWithMd,
        target_resolution_method: "exact_path",
      };
    }

    const lowerTarget = normalized.toLowerCase();
    const lowerTargetWithMd = normalizedWithMd.toLowerCase();

    const directMatches =
      markdownByName.get(lowerTarget) ?? markdownByName.get(lowerTargetWithMd);

    if (directMatches?.length === 1) {
      return {
        target_exists: "true",
        resolved_target_path: directMatches.at(0) ?? "",
        target_resolution_method: "unique_name",
      };
    }

    if (directMatches !== undefined && directMatches.length > 1) {
      return {
        target_exists: "ambiguous",
        resolved_target_path: directMatches.join("; "),
        target_resolution_method: "multiple_name_matches",
      };
    }

    const basename = normalizePath(normalized.split("/").pop() ?? normalized).toLowerCase();
    const basenameWithoutMd = basename.replace(/\.md$/i, "");
    const basenameWithMd = `${basenameWithoutMd}.md`;

    const basenameMatches =
      markdownByName.get(basenameWithoutMd) ?? markdownByName.get(basenameWithMd);

    if (basenameMatches?.length === 1) {
      return {
        target_exists: "true",
        resolved_target_path: basenameMatches.at(0) ?? "",
        target_resolution_method: "unique_basename",
      };
    }

    if (basenameMatches !== undefined && basenameMatches.length > 1) {
      return {
        target_exists: "ambiguous",
        resolved_target_path: basenameMatches.join("; "),
        target_resolution_method: "multiple_basename_matches",
      };
    }

    return {
      target_exists: "false",
      resolved_target_path: "",
      target_resolution_method: "not_found",
    };
  }

  cleanNoteTarget(target: string): string {
    const withoutHeading = target.split("#").at(0) ?? "";
    const withoutQuery = withoutHeading.split("?").at(0) ?? "";

    return normalizePath(withoutQuery.trim());
  }

  isResolvedPathInScope(path: string, scope: AgentContextScope): string {
    if (!path) return "";
    if (scope.scope_type === "vault") return "true";

    const normalizedPath = normalizePath(path);
    const normalizedScope = normalizePath(scope.scope_path);

    return normalizedPath.startsWith(`${normalizedScope}/`) ? "true" : "false";
  }

  buildNoteLinkGraphCsv(rows: CsvRow[]): string {
    const header = [
      "source_path",
      "source_basename",
      "target_raw",
      "target_note_guess",
      "resolved_target_path",
      "target_exists",
      "target_resolution_method",
      "target_within_scope",
      "link_text",
    ];
    return this.buildGenericCsv(rows, header);
  }

  buildNoteLinkGraphSummary(
    vaultName: string,
    generatedAt: string,
    scope: AgentContextScope,
    allRows: CsvRow[],
    indexedRows: CsvRow[]
  ): string {
    const sourceCounts = this.countByField(allRows, "source_path");
    const targetCounts = this.countByField(allRows, "target_raw");
    const existenceCounts = this.countByField(allRows, "target_exists");
    const resolutionCounts = this.countByField(allRows, "target_resolution_method");
    const withinScopeCounts = this.countByField(allRows, "target_within_scope");

    return `# Note Link Graph Summary

Vault: ${vaultName}

Generated at: ${generatedAt}

Scope type: ${scope.scope_type}

Scope path: ${scope.scope_path || "(vault root)"}

## Summary

- Total wikilinks found: ${String(allRows.length)}
- Wikilinks written to CSV: ${String(indexedRows.length)}
- Notes with outgoing links: ${String(sourceCounts.size)}
- Unique link targets: ${String(targetCounts.size)}
- CSV capped: ${indexedRows.length < allRows.length ? "true" : "false"}

## Target existence

${this.formatTopCounts(existenceCounts, 10)}

## Target within scope

${this.formatTopCounts(withinScopeCounts, 10)}

## Resolution methods

${this.formatTopCounts(resolutionCounts, 20)}

## Top notes by outgoing links

${this.formatTopCounts(sourceCounts, 20)}

## Top link targets

${this.formatTopCounts(targetCounts, 20)}
`;
  }

  buildBacklinkSummary(
    vaultName: string,
    generatedAt: string,
    scope: AgentContextScope,
    allRows: CsvRow[]
  ): string {
    const incomingCounts = new Map<string, number>();
    const outgoingCounts = new Map<string, number>();
    const brokenLinks = allRows.filter((row) => row["target_exists"] === "false");
    const ambiguousLinks = allRows.filter((row) => row["target_exists"] === "ambiguous");

    for (const row of allRows) {
      const sourcePath = row["source_path"] ?? "";
      const target = row["resolved_target_path"] || row["target_raw"] || "";

      if (sourcePath.length > 0) {
        outgoingCounts.set(sourcePath, (outgoingCounts.get(sourcePath) ?? 0) + 1);
      }

      if (target.length > 0) {
        incomingCounts.set(target, (incomingCounts.get(target) ?? 0) + 1);
      }
    }

    const hubCandidates = Array.from(incomingCounts.entries())
      .map(([path, incoming]) => {
        return {
          path,
          incoming,
          outgoing: outgoingCounts.get(path) ?? 0,
        };
      })
      .sort((a, b) => b.incoming + b.outgoing - (a.incoming + a.outgoing))
      .slice(0, 20);

    return `# Backlink Summary

Vault: ${vaultName}

Generated at: ${generatedAt}

Scope type: ${scope.scope_type}

Scope path: ${scope.scope_path || "(vault root)"}

## Summary

- Total wikilinks from scoped notes: ${String(allRows.length)}
- Broken note links: ${String(brokenLinks.length)}
- Ambiguous note links: ${String(ambiguousLinks.length)}
- Notes or targets with incoming links: ${String(incomingCounts.size)}
- Notes with outgoing links: ${String(outgoingCounts.size)}

## Top incoming-link targets

${this.formatTopCounts(incomingCounts, 20)}

## Top outgoing-link notes

${this.formatTopCounts(outgoingCounts, 20)}

## Potential hub notes

${
  hubCandidates.length > 0
    ? hubCandidates
        .map((item) => `- ${item.path}: incoming ${String(item.incoming)}, outgoing ${String(item.outgoing)}`)
        .join("\n")
    : "- None"
}

## Broken link examples

${
  brokenLinks.length > 0
    ? brokenLinks
        .slice(0, 20)
        .map((row) => `- ${row["source_path"] ?? ""} -> ${row["target_raw"] ?? ""}`)
        .join("\n")
    : "- None"
}

## Ambiguous link examples

${
  ambiguousLinks.length > 0
    ? ambiguousLinks
        .slice(0, 20)
        .map((row) => `- ${row["source_path"] ?? ""} -> ${row["target_raw"] ?? ""}`)
        .join("\n")
    : "- None"
}
`;
  }

  buildFrontmatterRows(files: TFile[]): CsvRow[] {
    const rows: CsvRow[] = [];

    for (const file of files) {
      const cache = this.app.metadataCache.getFileCache(file);
      const frontmatter = this.asRecord(cache?.frontmatter);
      const tags = this.extractTags(cache);

      rows.push({
        path: file.path,
        basename: file.basename,
        folder: file.parent?.path ?? "",
        has_frontmatter: Object.keys(frontmatter).length > 0 ? "true" : "false",
        tags: tags.join("; "),
        type: this.stringifyFrontmatterValue(frontmatter["type"]),
        status: this.stringifyFrontmatterValue(frontmatter["status"]),
        title: this.stringifyFrontmatterValue(frontmatter["title"]),
        date: this.stringifyFrontmatterValue(frontmatter["date"]),
      });
    }

    return rows;
  }

  extractTags(cache: CachedMetadata | null): string[] {
    const tags = new Set<string>();

    if (cache?.tags) {
      for (const tagObj of cache.tags) {
        const tag = tagObj.tag.replace(/^#/, "").trim();

        if (tag && !this.looksLikeHexColor(tag)) tags.add(tag);
      }
    }

    const frontmatter = this.asRecord(cache?.frontmatter);
    const frontmatterTags = frontmatter["tags"];

    if (Array.isArray(frontmatterTags)) {
      for (const tag of frontmatterTags) {
        const cleanTag = this.stringifyFrontmatterValue(tag).replace(/^#/, "").trim();

        if (cleanTag && !this.looksLikeHexColor(cleanTag)) tags.add(cleanTag);
      }
    } else if (typeof frontmatterTags === "string") {
      for (const tag of frontmatterTags.split(",")) {
        const cleanTag = tag.replace(/^#/, "").trim();

        if (cleanTag && !this.looksLikeHexColor(cleanTag)) tags.add(cleanTag);
      }
    }

    return Array.from(tags).sort();
  }

  looksLikeHexColor(value: string): boolean {
    return /^[0-9A-Fa-f]{3}$|^[0-9A-Fa-f]{6}$/.test(value);
  }

  stringifyFrontmatterValue(value: unknown): string {
    if (value === null || value === undefined) return "";

    if (Array.isArray(value)) {
      return value.map((item) => this.stringifyFrontmatterValue(item)).join("; ");
    }

    if (typeof value === "string") return value;
    if (typeof value === "number") return String(value);
    if (typeof value === "boolean") return String(value);
    if (typeof value === "bigint") return String(value);

    if (typeof value === "object") {
      try {
        return JSON.stringify(value);
      } catch {
        return "";
      }
    }

    return "";
  }

  buildFrontmatterIndexCsv(rows: CsvRow[]): string {
    const header = [
      "path",
      "basename",
      "folder",
      "has_frontmatter",
      "tags",
      "type",
      "status",
      "title",
      "date",
    ];
    return this.buildGenericCsv(rows, header);
  }

  buildFrontmatterSummary(
    vaultName: string,
    generatedAt: string,
    scope: AgentContextScope,
    allRows: CsvRow[],
    indexedRows: CsvRow[]
  ): string {
    const tagCounts = new Map<string, number>();
    const typeCounts = new Map<string, number>();
    const statusCounts = new Map<string, number>();

    for (const row of allRows) {
      const tags = row["tags"] ?? "";

      if (tags.length > 0) {
        for (const tag of tags
          .split(";")
          .map((item) => item.trim())
          .filter(Boolean)) {
          tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
        }
      }

      const type = row["type"] ?? "";
      const status = row["status"] ?? "";

      if (type.length > 0) typeCounts.set(type, (typeCounts.get(type) ?? 0) + 1);
      if (status.length > 0) statusCounts.set(status, (statusCounts.get(status) ?? 0) + 1);
    }

    const frontmatterCount = allRows.filter((row) => row["has_frontmatter"] === "true").length;
    const taggedCount = allRows.filter((row) => (row["tags"] ?? "") !== "").length;

    return `# Frontmatter Index Summary

Vault: ${vaultName}

Generated at: ${generatedAt}

Scope type: ${scope.scope_type}

Scope path: ${scope.scope_path || "(vault root)"}

## Summary

- Total notes in scope: ${String(allRows.length)}
- Rows written to CSV: ${String(indexedRows.length)}
- Notes with frontmatter: ${String(frontmatterCount)}
- Notes with tags: ${String(taggedCount)}
- Unique tags: ${String(tagCounts.size)}
- Unique type values: ${String(typeCounts.size)}
- Unique status values: ${String(statusCounts.size)}
- CSV capped: ${indexedRows.length < allRows.length ? "true" : "false"}

## Top tags

${this.formatTopCounts(tagCounts, 20)}

## Type values

${this.formatTopCounts(typeCounts, 20)}

## Status values

${this.formatTopCounts(statusCounts, 20)}
`;
  }

  buildFilesByNameMap(files: TFile[]): Map<string, string[]> {
    const result = new Map<string, string[]>();

    for (const file of files) {
      const normalizedPath = normalizePath(file.path);
      const names = new Set<string>([file.name, file.basename, file.path, normalizedPath]);

      for (const name of names) {
        const cleanName = normalizePath(name).toLowerCase();
        const existing = result.get(cleanName) ?? [];
        existing.push(normalizedPath);
        result.set(cleanName, existing);
      }
    }

    return result;
  }

  async buildAttachmentReferenceRows(
    files: TFile[],
    allFilePathSet: Set<string>,
    allFilesByName: Map<string, string[]>,
    scope: AgentContextScope
  ): Promise<CsvRow[]> {
    const rows: CsvRow[] = [];
    const nonMarkdownExtensions = new Set([
      "pdf",
      "png",
      "jpg",
      "jpeg",
      "gif",
      "svg",
      "webp",
      "csv",
      "tsv",
      "json",
      "xlsx",
      "xls",
      "docx",
      "doc",
      "pptx",
      "ppt",
      "txt",
      "mp3",
      "wav",
      "mp4",
      "mov",
    ]);

    for (const file of files) {
      const content = await this.app.vault.cachedRead(file);
      const cleanedContent = this.removeFencedCodeBlocks(content);

      const wikiLinkRegex = /(!)?\[\[([^\]]+)\]\]/g;
      let wikiMatch: RegExpExecArray | null;

      while ((wikiMatch = wikiLinkRegex.exec(cleanedContent)) !== null) {
        const isEmbed = wikiMatch[1] === "!";
        const rawTarget = (wikiMatch[2] ?? "").trim();
        if (!rawTarget) continue;

        const [targetPart = "", aliasPart = ""] = rawTarget.split("|");
        const target = targetPart.trim();
        const linkText = aliasPart.trim() || target;
        const targetExtension = this.extractExtensionFromPath(target);

        if (!targetExtension || !nonMarkdownExtensions.has(targetExtension)) continue;

        const resolved = this.resolveTargetPath(target, allFilePathSet, allFilesByName);

        rows.push({
          source_note_path: file.path,
          source_note_basename: file.basename,
          target_raw: target,
          target_path_guess: normalizePath(target),
          resolved_target_path: resolved.resolved_target_path,
          target_exists: resolved.target_exists,
          target_resolution_method: resolved.target_resolution_method,
          target_within_scope: this.isResolvedPathInScope(resolved.resolved_target_path, scope),
          target_extension: targetExtension,
          reference_type: isEmbed ? "embed" : "wikilink",
          link_text: linkText,
        });
      }

      const markdownLinkRegex = /(!)?\[([^\]]*)\]\(([^)]+)\)/g;
      let markdownMatch: RegExpExecArray | null;

      while ((markdownMatch = markdownLinkRegex.exec(cleanedContent)) !== null) {
        const isEmbed = markdownMatch[1] === "!";
        const linkText = (markdownMatch[2] ?? "").trim();
        const target = (markdownMatch[3] ?? "").trim();
        const targetExtension = this.extractExtensionFromPath(target);

        if (!targetExtension || !nonMarkdownExtensions.has(targetExtension)) continue;

        const resolved = this.resolveTargetPath(target, allFilePathSet, allFilesByName);

        rows.push({
          source_note_path: file.path,
          source_note_basename: file.basename,
          target_raw: target,
          target_path_guess: normalizePath(target),
          resolved_target_path: resolved.resolved_target_path,
          target_exists: resolved.target_exists,
          target_resolution_method: resolved.target_resolution_method,
          target_within_scope: this.isResolvedPathInScope(resolved.resolved_target_path, scope),
          target_extension: targetExtension,
          reference_type: isEmbed ? "markdown_embed" : "markdown_link",
          link_text: linkText || target,
        });
      }
    }

    return rows;
  }

  resolveTargetPath(
    target: string,
    allFilePathSet: Set<string>,
    allFilesByName: Map<string, string[]>
  ): ResolvedTarget {
    const withoutHeading = target.split("#").at(0) ?? "";
    const withoutQuery = withoutHeading.split("?").at(0) ?? "";
    const cleanTarget = normalizePath(withoutQuery.trim());
    const lowerTarget = cleanTarget.toLowerCase();

    if (allFilePathSet.has(cleanTarget)) {
      return {
        target_exists: "true",
        resolved_target_path: cleanTarget,
        target_resolution_method: "exact_path",
      };
    }

    const nameMatches = allFilesByName.get(lowerTarget);
    if (nameMatches?.length === 1) {
      return {
        target_exists: "true",
        resolved_target_path: nameMatches.at(0) ?? "",
        target_resolution_method: "unique_name",
      };
    }

    if (nameMatches !== undefined && nameMatches.length > 1) {
      return {
        target_exists: "ambiguous",
        resolved_target_path: nameMatches.join("; "),
        target_resolution_method: "multiple_name_matches",
      };
    }

    const fileName = normalizePath(cleanTarget.split("/").pop() ?? cleanTarget).toLowerCase();
    const fileNameMatches = allFilesByName.get(fileName);

    if (fileNameMatches?.length === 1) {
      return {
        target_exists: "true",
        resolved_target_path: fileNameMatches.at(0) ?? "",
        target_resolution_method: "unique_filename",
      };
    }

    if (fileNameMatches !== undefined && fileNameMatches.length > 1) {
      return {
        target_exists: "ambiguous",
        resolved_target_path: fileNameMatches.join("; "),
        target_resolution_method: "multiple_filename_matches",
      };
    }

    return {
      target_exists: "false",
      resolved_target_path: "",
      target_resolution_method: "not_found",
    };
  }

  extractExtensionFromPath(path: string): string {
    const withoutHeading = path.split("#").at(0) ?? "";
    const withoutQuery = withoutHeading.split("?").at(0) ?? "";
    const cleanPath = withoutQuery.trim();
    const lastPart = cleanPath.split("/").pop() ?? cleanPath;
    const parts = lastPart.split(".");

    return parts.length < 2 ? "" : parts.at(-1)?.toLowerCase() ?? "";
  }

  buildAttachmentReferenceGraphCsv(rows: CsvRow[]): string {
    const header = [
      "source_note_path",
      "source_note_basename",
      "target_raw",
      "target_path_guess",
      "resolved_target_path",
      "target_exists",
      "target_resolution_method",
      "target_within_scope",
      "target_extension",
      "reference_type",
      "link_text",
    ];
    return this.buildGenericCsv(rows, header);
  }

  buildAttachmentReferenceSummary(
    vaultName: string,
    generatedAt: string,
    scope: AgentContextScope,
    allRows: CsvRow[],
    indexedRows: CsvRow[]
  ): string {
    const extensionCounts = this.countByField(allRows, "target_extension");
    const referenceTypeCounts = this.countByField(allRows, "reference_type");
    const sourceCounts = this.countByField(allRows, "source_note_path");
    const existenceCounts = this.countByField(allRows, "target_exists");
    const resolutionCounts = this.countByField(allRows, "target_resolution_method");
    const withinScopeCounts = this.countByField(allRows, "target_within_scope");

    return `# Attachment Reference Summary

Vault: ${vaultName}

Generated at: ${generatedAt}

Scope type: ${scope.scope_type}

Scope path: ${scope.scope_path || "(vault root)"}

## Summary

- Total attachment / non-Markdown references found: ${String(allRows.length)}
- Rows written to CSV: ${String(indexedRows.length)}
- CSV capped: ${indexedRows.length < allRows.length ? "true" : "false"}

## Target existence

${this.formatTopCounts(existenceCounts, 10)}

## Target within scope

${this.formatTopCounts(withinScopeCounts, 10)}

## Resolution methods

${this.formatTopCounts(resolutionCounts, 20)}

## Referenced file extensions

${this.formatTopCounts(extensionCounts, 30)}

## Reference types

${this.formatTopCounts(referenceTypeCounts, 20)}

## Top source notes

${this.formatTopCounts(sourceCounts, 20)}

## Notes

This file records references from Markdown notes to non-Markdown files.

The plugin does not parse PDF, Word, Excel, image, audio, or video content.
It only records metadata-level references to help agents navigate the vault.

Rows where target_exists is true are the safest candidates for direct file reading.
Rows where target_exists is ambiguous may need manual inspection.
Rows where target_exists is false may indicate stale links, external paths, or files not stored in the vault.
`;
  }

  buildFolderTreeSummary(
    vaultName: string,
    generatedAt: string,
    scope: AgentContextScope,
    files: TFile[]
  ): string {
    const folderCounts = new Map<string, number>();

    for (const file of files) {
      const folder = file.parent?.path ?? "";
      const parts = folder ? folder.split("/") : [];
      const maxDepth = Math.min(parts.length, MAX_FOLDER_TREE_DEPTH);

      for (let depth = 0; depth <= maxDepth; depth++) {
        const folderKey = depth === 0 ? "(root)" : parts.slice(0, depth).join("/");
        folderCounts.set(folderKey, (folderCounts.get(folderKey) ?? 0) + 1);
      }
    }

    const rows = Array.from(folderCounts.entries())
      .map(([folder, count]) => {
        const depth = folder === "(root)" ? 0 : folder.split("/").length;
        return { folder, count, depth };
      })
      .sort((a, b) => {
        if (a.depth !== b.depth) return a.depth - b.depth;
        return a.folder.localeCompare(b.folder);
      })
      .slice(0, MAX_FOLDER_TREE_ROWS);

    return `# Folder Tree Summary

Vault: ${vaultName}

Generated at: ${generatedAt}

Scope type: ${scope.scope_type}

Scope path: ${scope.scope_path || "(vault root)"}

## Summary

- Max displayed depth: ${String(MAX_FOLDER_TREE_DEPTH)}
- Max displayed rows: ${String(MAX_FOLDER_TREE_ROWS)}
- Rows displayed: ${String(rows.length)}
- This is a folder-level overview, not a full file listing.

## Folder overview

${
  rows.length > 0
    ? rows
        .map((row) => {
          const indent = "  ".repeat(row.depth);
          return `${indent}- ${row.folder}: ${String(row.count)} files`;
        })
        .join("\n")
    : "- None"
}
`;
  }

  buildLargeIndexNotice(
    vaultName: string,
    generatedAt: string,
    scope: AgentContextScope,
    capRecords: CapRecord[]
  ): string {
    return `# Large Index Notice

Vault: ${vaultName}

Generated at: ${generatedAt}

Scope type: ${scope.scope_type}

Scope path: ${scope.scope_path || "(vault root)"}

## Summary

- Capped outputs: ${String(capRecords.length)}
- The index is intentionally capped to keep files agent-readable.
- A capped output is not a complete dump.

## Capped outputs

${
  capRecords.length > 0
    ? capRecords
        .map(
          (record) =>
            `- ${record.output}: wrote ${String(record.indexed_rows)} of ${String(
              record.total_rows
            )} rows, cap ${String(record.cap)}`
        )
        .join("\n")
    : "- None"
}

## Recommended behavior for agents

When an output is capped, do not assume it contains every matching item.

Use the capped output for breadth-first navigation. Then read original source files only after choosing a small number of likely relevant candidates.

For very large vaults or broad root scans, ask the user to run folder-level agent context generation on a narrower folder if more focused context is needed.
`;
  }

  async writeSafeAgentPointer(
    primaryPath: string,
    fallbackPath: string,
    pointerContent: string
  ): Promise<Record<string, string>> {
    const primaryExists = await this.app.vault.adapter.exists(primaryPath);

    if (!primaryExists) {
      await this.app.vault.adapter.write(primaryPath, pointerContent);

      return {
        status: "created_primary",
        primary_path: primaryPath,
        fallback_path: "",
        message: "AGENTS.md did not exist, so the plugin created it.",
      };
    }

    await this.app.vault.adapter.write(fallbackPath, pointerContent);

    return {
      status: "created_fallback_existing_primary",
      primary_path: primaryPath,
      fallback_path: fallbackPath,
      message:
        "AGENTS.md already existed, so the plugin left it unchanged and created AGENTS.agent-context-indexer.md. User or agent can merge manually.",
    };
  }

  buildAgentPointerContent(scope: AgentContextScope): string {
    const scopeLabel =
      scope.scope_type === "vault"
        ? "This vault uses Agent Context Indexing."
        : `This folder uses a folder-level Agent Context Index for scope: ${scope.scope_path}`;

    return `# Agent Context Index

${scopeLabel}

Before exploring this ${scope.scope_type === "vault" ? "vault" : "folder"} directly, read:

\`${scope.output_dir}/agent_context_manifest.json\`

Recommended workflow:

1. Read \`${scope.output_dir}/agent_context_manifest.json\`.
2. Read \`${scope.output_dir}/directory_context.md\`.
3. Read \`${scope.output_dir}/large_index_notice.md\`.
4. Read \`${scope.output_dir}/folder_tree_summary.md\`.
5. Read \`${scope.output_dir}/file_inventory_summary.md\`.
6. Read \`${scope.output_dir}/inventory_group_counts.csv\`.
7. Use the category-specific inventory files only as needed.
8. Use \`${scope.output_dir}/note_index.csv\`, \`${scope.output_dir}/markdown_outline.csv\`, \`${scope.output_dir}/note_link_graph.csv\`, \`${scope.output_dir}/backlink_summary.md\`, and \`${scope.output_dir}/frontmatter_index.csv\` for note navigation.
9. Use \`${scope.output_dir}/attachment_reference_graph.csv\` to understand references from notes to PDFs, images, data files, and other non-Markdown files.
10. Prefer rows where target_exists is true before trying to read original files.
11. Read original source files only after selecting a small number of relevant candidates.

Important notes:

- The index is breadth-first and metadata-first.
- The index is intentionally capped to avoid large single files.
- Non-Markdown files are indexed by metadata only.
- If this file was generated as AGENTS.agent-context-indexer.md, an existing AGENTS.md was not overwritten. Merge manually if desired.
- If the index looks stale, ask the user to rerun the appropriate agent context command in Obsidian.
`;
  }

  buildGenericCsv(rows: CsvRow[], header: string[]): string {
    const csvRows = rows.map((row) =>
      header.map((key) => this.csvEscape(row[key] ?? "")).join(",")
    );
    return [header.join(","), ...csvRows].join("\n");
  }

  countByField(rows: CsvRow[], field: string): Map<string, number> {
    const counts = new Map<string, number>();

    for (const row of rows) {
      const value = row[field] || "(blank)";
      counts.set(value, (counts.get(value) ?? 0) + 1);
    }

    return counts;
  }

  formatTopCounts(counts: Map<string, number>, limit: number): string {
    const items = Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit);

    if (items.length === 0) return "- None";

    return items.map(([name, count]) => `- ${name}: ${String(count)}`).join("\n");
  }

  limitRowsWithCapRecord<T>(
    rows: T[],
    limit: number,
    output: string,
    capRecords: CapRecord[]
  ): T[] {
    if (rows.length > limit) {
      capRecords.push({
        output,
        total_rows: rows.length,
        indexed_rows: limit,
        cap: limit,
      });
    }

    return rows.slice(0, limit);
  }

  removeFencedCodeBlocks(content: string): string {
    return content.replace(/```[\s\S]*?```/g, "");
  }

  csvEscape(value: string): string {
    if (value.includes(",") || value.includes('"') || value.includes("\n")) {
      return `"${value.replace(/"/g, '""')}"`;
    }
    return value;
  }

  async ensureFolder(folderPath: string): Promise<void> {
    const parts = normalizePath(folderPath).split("/");
    let current = "";

    for (const part of parts) {
      current = current ? `${current}/${part}` : part;

      const exists = await this.app.vault.adapter.exists(current);

      if (!exists) {
        await this.app.vault.adapter.mkdir(current);
      }
    }
  }

  async loadSettings(): Promise<void> {
    const savedData: unknown = await this.loadData();

    if (!this.isRecord(savedData)) {
      this.settings = { ...DEFAULT_SETTINGS };
      return;
    }

    this.settings = {
      folderScopePaths:
        typeof savedData["folderScopePaths"] === "string"
          ? savedData["folderScopePaths"]
          : DEFAULT_SETTINGS.folderScopePaths,
      stalenessDays:
        typeof savedData["stalenessDays"] === "number"
          ? savedData["stalenessDays"]
          : DEFAULT_SETTINGS.stalenessDays,
      autoCheckOnStartup:
        typeof savedData["autoCheckOnStartup"] === "boolean"
          ? savedData["autoCheckOnStartup"]
          : DEFAULT_SETTINGS.autoCheckOnStartup,
      autoRefreshVaultOnStartup:
        typeof savedData["autoRefreshVaultOnStartup"] === "boolean"
          ? savedData["autoRefreshVaultOnStartup"]
          : DEFAULT_SETTINGS.autoRefreshVaultOnStartup,
      autoRefreshFoldersOnStartup:
        typeof savedData["autoRefreshFoldersOnStartup"] === "boolean"
          ? savedData["autoRefreshFoldersOnStartup"]
          : DEFAULT_SETTINGS.autoRefreshFoldersOnStartup,
    };
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
  }
  
  asRecord(value: unknown): Record<string, unknown> {
  return this.isRecord(value) ? value : {};
  }
}

class ObsidianAgentContextSettingTab extends PluginSettingTab {
  plugin: ObsidianAgentContextPlugin;

  constructor(app: App, plugin: ObsidianAgentContextPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;

    containerEl.empty();

    new Setting(containerEl)
      .setName("Configuration")
      .setHeading();

    new Setting(containerEl)
      .setName("Folder scopes")
      .setDesc(
        "One folder path per line. These folders can be indexed separately for lower-noise folder-level context."
      )
      .addTextArea((text) => {
        text
          .setPlaceholder("Projects/example-project\nliterature\nresearch/papers")
          .setValue(this.plugin.settings.folderScopePaths)
          .onChange(async (value) => {
            this.plugin.settings.folderScopePaths = value;
            await this.plugin.saveSettings();
          });

        text.inputEl.rows = 8;
        text.inputEl.cols = 40;
      });

    new Setting(containerEl)
      .setName("Staleness days")
      .setDesc("Used for startup stale checks. A value of 7 means weekly refresh is suggested.")
      .addText((text) =>
        text
          .setPlaceholder("7")
          .setValue(String(this.plugin.settings.stalenessDays))
          .onChange(async (value) => {
            const parsed = Number(value);
            this.plugin.settings.stalenessDays =
              Number.isFinite(parsed) && parsed > 0 ? parsed : 7;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Check staleness on startup")
      .setDesc("If enabled, the plugin checks whether indexes are missing or stale when Obsidian starts.")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.autoCheckOnStartup)
          .onChange(async (value) => {
            this.plugin.settings.autoCheckOnStartup = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Auto-refresh vault on startup")
      .setDesc("If enabled, stale vault-level context is refreshed automatically on startup. Default is off.")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.autoRefreshVaultOnStartup)
          .onChange(async (value) => {
            this.plugin.settings.autoRefreshVaultOnStartup = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Auto-refresh configured folders on startup")
      .setDesc("If enabled, stale configured folder-level contexts are refreshed automatically on startup. Default is off.")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.autoRefreshFoldersOnStartup)
          .onChange(async (value) => {
            this.plugin.settings.autoRefreshFoldersOnStartup = value;
            await this.plugin.saveSettings();
          })
      );
  }
}
