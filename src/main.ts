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

type Row = Record<string, string>;

type Scope = {
  type: "vault" | "folder";
  path: string;
  slug: string;
  outDir: string;
};

type Resolved = {
  exists: string;
  path: string;
  method: string;
};

type CapRecord = {
  output: string;
  total_rows: number;
  indexed_rows: number;
  cap: number;
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

interface AgentContextSettings {
  folderScopePaths: string;
  stalenessDays: number;
  autoCheckOnStartup: boolean;
  autoRefreshVaultOnStartup: boolean;
  autoRefreshFoldersOnStartup: boolean;
}

const DEFAULT_SETTINGS: AgentContextSettings = {
  folderScopePaths: "",
  stalenessDays: 7,
  autoCheckOnStartup: true,
  autoRefreshVaultOnStartup: false,
  autoRefreshFoldersOnStartup: false,
};

const CAPS = {
  noteIndex: 1000,
  outline: 2000,
  links: 2000,
  frontmatter: 1000,
  inventoryByCategory: 500,
  attachments: 2000,
  folderTreeRows: 300,
  folderTreeDepth: 3,
};

const CODE_EXT = new Set([
  "py", "js", "ts", "jsx", "tsx", "html", "css", "scss", "sql", "r", "java",
  "kt", "c", "cpp", "h", "hpp", "cs", "go", "rs", "sh", "bat", "ps1",
  "m", "scala", "swift",
]);

const DATA_EXT = new Set([
  "csv", "tsv", "json", "jsonl", "yaml", "yml", "xml", "parquet", "feather",
  "sqlite", "db", "pkl",
]);

const DOC_EXT = new Set([
  "pdf", "doc", "docx", "ppt", "pptx", "xls", "xlsx", "rtf", "txt",
]);

const MEDIA_EXT = new Set([
  "png", "jpg", "jpeg", "gif", "svg", "webp", "mp3", "wav", "mp4", "mov",
  "avi", "mkv",
]);

const ATTACHMENT_EXT = new Set([
  ...Array.from(DATA_EXT),
  ...Array.from(DOC_EXT),
  ...Array.from(MEDIA_EXT),
]);

export default class ObsidianAgentContextPlugin extends Plugin {
  settings!: AgentContextSettings;

  async onload() {
    await this.loadSettings();
    this.addSettingTab(new AgentContextSettingTab(this.app, this));

    this.addCommand({
      id: "generate-vault-agent-context",
      name: "Generate Vault Agent Context",
      callback: async () => {
        try {
          await this.generateScope(this.vaultScope());
          new Notice("Vault Agent Context generated.");
        } catch (error) {
          console.error(error);
          new Notice("Failed to generate vault context. Check console.");
        }
      },
    });

    this.addCommand({
      id: "generate-configured-folder-contexts",
      name: "Generate Configured Folder Contexts",
      callback: async () => {
        try {
          const results = await this.generateConfiguredFolders();
          new Notice(`Generated ${results.length} folder context index(es).`);
        } catch (error) {
          console.error(error);
          new Notice("Failed to generate folder contexts. Check console.");
        }
      },
    });

    this.addCommand({
      id: "generate-all-agent-contexts",
      name: "Generate All Agent Contexts",
      callback: async () => {
        try {
          await this.generateScope(this.vaultScope());
          const results = await this.generateConfiguredFolders();
          new Notice(`Generated vault context and ${results.length} folder context index(es).`);
        } catch (error) {
          console.error(error);
          new Notice("Failed to generate all contexts. Check console.");
        }
      },
    });

    if (this.settings.autoCheckOnStartup) {
      window.setTimeout(() => {
        this.checkStalenessOnStartup().catch((error) => console.error(error));
      }, 2000);
    }
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  vaultScope(): Scope {
    return {
      type: "vault",
      path: "",
      slug: "vault",
      outDir: ".agent_context/latest",
    };
  }

  folderScopes(): Scope[] {
    const paths = this.settings.folderScopePaths
      .split(/\r?\n/)
      .map((x) => normalizePath(x.trim()))
      .filter(Boolean)
      .filter((x) => !x.startsWith(".agent_context/"))
      .filter((x) => !x.startsWith(".obsidian/"));

    return Array.from(new Set(paths)).map((path) => ({
      type: "folder",
      path,
      slug: this.slug(path),
      outDir: `.agent_context/folders/${this.slug(path)}/latest`,
    }));
  }

  slug(path: string): string {
    return (
      normalizePath(path)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "__")
        .replace(/^_+|_+$/g, "") || "folder"
    );
  }

  async generateConfiguredFolders(): Promise<ScopeResult[]> {
    const scopes = this.folderScopes();
    if (scopes.length === 0) {
      new Notice("No folder scopes configured. Add folder paths in settings.");
      return [];
    }

    const results: ScopeResult[] = [];
    for (const scope of scopes) {
      if (!(await this.app.vault.adapter.exists(scope.path))) {
        new Notice(`Folder scope not found: ${scope.path}`);
        continue;
      }
      results.push(await this.generateScope(scope));
    }

    await this.writeFolderRegistry(results);
    return results;
  }

  async checkStalenessOnStartup() {
    const vault = this.vaultScope();
    const vaultStatus = await this.staleness(vault.outDir);

    if (vaultStatus === "missing") {
      new Notice("Vault Agent Context is missing. Run Generate Vault Agent Context.");
    } else if (vaultStatus === "stale") {
      if (this.settings.autoRefreshVaultOnStartup) {
        await this.generateScope(vault);
        new Notice("Refreshed stale vault Agent Context.");
      } else {
        new Notice("Vault Agent Context may be stale. Run Generate Vault Agent Context.");
      }
    }

    const staleFolders: Scope[] = [];
    for (const scope of this.folderScopes()) {
      const status = await this.staleness(scope.outDir);
      if (status !== "fresh") staleFolders.push(scope);
    }

    if (staleFolders.length === 0) return;

    if (this.settings.autoRefreshFoldersOnStartup) {
      const results: ScopeResult[] = [];
      for (const scope of staleFolders) {
        if (await this.app.vault.adapter.exists(scope.path)) {
          results.push(await this.generateScope(scope));
        }
      }
      await this.writeFolderRegistry(results);
      new Notice(`Refreshed ${results.length} stale folder context index(es).`);
    } else {
      new Notice(`${staleFolders.length} folder Agent Context index(es) may be stale or missing.`);
    }
  }

  async staleness(outDir: string): Promise<"fresh" | "stale" | "missing"> {
    const manifestPath = `${outDir}/agent_context_manifest.json`;
    if (!(await this.app.vault.adapter.exists(manifestPath))) return "missing";

    try {
      const manifest = JSON.parse(await this.app.vault.adapter.read(manifestPath));
      const generatedAt = new Date(String(manifest.generated_at));
      const ageMs = Date.now() - generatedAt.getTime();
      const staleMs = this.settings.stalenessDays * 24 * 60 * 60 * 1000;
      return Number.isFinite(ageMs) && ageMs <= staleMs ? "fresh" : "stale";
    } catch {
      return "stale";
    }
  }

  async generateScope(scope: Scope): Promise<ScopeResult> {
    await this.ensureFolder(scope.outDir);

    const vaultName = this.app.vault.getName();
    const now = new Date().toISOString();
    const capRecords: CapRecord[] = [];

    const vaultFiles = this.app.vault
      .getFiles()
      .filter((f) => !this.isGeneratedOrPluginFile(f))
      .sort((a, b) => a.path.localeCompare(b.path));

    const files = vaultFiles.filter((f) => this.inScope(f, scope));
    const mdFiles = files.filter((f) => f.extension.toLowerCase() === "md");
    const vaultMdFiles = vaultFiles.filter((f) => f.extension.toLowerCase() === "md");

    const vaultPathSet = new Set(vaultFiles.map((f) => normalizePath(f.path)));
    const vaultByName = this.filesByName(vaultFiles);
    const vaultMdPathSet = new Set(vaultMdFiles.map((f) => normalizePath(f.path)));
    const vaultMdByName = this.filesByName(vaultMdFiles);

    const inventoryRows = this.fileInventoryRows(files);
    const markdownInventory = this.limit(
      inventoryRows.filter((r) => r.file_category === "markdown_note"),
      CAPS.inventoryByCategory,
      "inventory_markdown.csv",
      capRecords
    );
    const codeInventory = this.limit(
      inventoryRows.filter((r) => r.file_category === "code"),
      CAPS.inventoryByCategory,
      "inventory_code.csv",
      capRecords
    );
    const dataInventory = this.limit(
      inventoryRows.filter((r) => r.file_category === "data"),
      CAPS.inventoryByCategory,
      "inventory_data.csv",
      capRecords
    );
    const documentInventory = this.limit(
      inventoryRows.filter((r) => r.file_category === "document"),
      CAPS.inventoryByCategory,
      "inventory_documents_sample.csv",
      capRecords
    );
    const mediaInventory = this.limit(
      inventoryRows.filter((r) => r.file_category === "media"),
      CAPS.inventoryByCategory,
      "inventory_media_sample.csv",
      capRecords
    );
    const otherInventory = this.limit(
      inventoryRows.filter((r) => r.file_category === "other"),
      CAPS.inventoryByCategory,
      "inventory_other_sample.csv",
      capRecords
    );

    const noteFiles = this.limit(mdFiles, CAPS.noteIndex, "note_index.csv", capRecords);
    const outlineAll = await this.markdownOutlineRows(mdFiles);
    const outlineRows = this.limit(outlineAll, CAPS.outline, "markdown_outline.csv", capRecords);

    const noteLinksAll = await this.noteLinkRows(mdFiles, vaultMdPathSet, vaultMdByName, scope);
    const noteLinks = this.limit(noteLinksAll, CAPS.links, "note_link_graph.csv", capRecords);

    const frontmatterAll = this.frontmatterRows(mdFiles);
    const frontmatterRows = this.limit(
      frontmatterAll,
      CAPS.frontmatter,
      "frontmatter_index.csv",
      capRecords
    );

    const attachmentsAll = await this.attachmentRows(mdFiles, vaultPathSet, vaultByName, scope);
    const attachments = this.limit(
      attachmentsAll,
      CAPS.attachments,
      "attachment_reference_graph.csv",
      capRecords
    );

    const pointer = await this.writeSafeAgentPointer(
      this.pointerPaths(scope).primary,
      this.pointerPaths(scope).fallback,
      this.agentPointerContent(scope)
    );

    const manifest = {
      tool_name: "Obsidian Agent Context",
      version: "0.1.0",
      generated_at: now,
      vault_name: vaultName,
      scope_type: scope.type,
      scope_path: scope.path,
      scope_slug: scope.slug,
      agent_context_location: scope.outDir,
      agent_pointer: pointer,
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
        max_note_index_rows: CAPS.noteIndex,
        max_markdown_outline_rows: CAPS.outline,
        max_note_link_rows: CAPS.links,
        max_frontmatter_rows: CAPS.frontmatter,
        max_inventory_rows_per_category: CAPS.inventoryByCategory,
        max_attachment_reference_rows: CAPS.attachments,
        max_folder_tree_rows: CAPS.folderTreeRows,
        max_folder_tree_depth: CAPS.folderTreeDepth,
      },
      cap_records: capRecords,
      counts: {
        total_files: files.length,
        markdown_notes_total: mdFiles.length,
        markdown_notes_indexed: noteFiles.length,
        inventory_rows_total: inventoryRows.length,
        markdown_outline_rows_total: outlineAll.length,
        markdown_outline_rows_indexed: outlineRows.length,
        note_links_total: noteLinksAll.length,
        note_links_indexed: noteLinks.length,
        note_links_resolved_targets: this.countValue(noteLinksAll, "target_exists", "true"),
        note_links_missing_targets: this.countValue(noteLinksAll, "target_exists", "false"),
        note_links_ambiguous_targets: this.countValue(noteLinksAll, "target_exists", "ambiguous"),
        frontmatter_notes: this.countValue(frontmatterAll, "has_frontmatter", "true"),
        tagged_notes: frontmatterAll.filter((r) => r.tags !== "").length,
        frontmatter_rows_total: frontmatterAll.length,
        frontmatter_rows_indexed: frontmatterRows.length,
        attachment_references_total: attachmentsAll.length,
        attachment_references_indexed: attachments.length,
        attachment_references_existing_targets: this.countValue(attachmentsAll, "target_exists", "true"),
        attachment_references_missing_targets: this.countValue(attachmentsAll, "target_exists", "false"),
        attachment_references_ambiguous_targets: this.countValue(attachmentsAll, "target_exists", "ambiguous"),
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
        scope.type === "vault" ? ".agent_context/folder_context_registry.csv" : "",
      staleness_policy: {
        staleness_days: this.settings.stalenessDays,
        refresh_cadence: this.settings.stalenessDays <= 1 ? "daily" : "custom",
      },
      agent_bootstrap_instruction:
        "Read agent_context_manifest.json first. Start with directory_context.md, large_index_notice.md, folder_tree_summary.md, file_inventory_summary.md, and inventory_group_counts.csv before opening detailed CSV files. Use capped inventories for breadth-first navigation, then read original source files only when needed.",
    };

    await this.writeText(scope, "agent_context_manifest.json", JSON.stringify(manifest, null, 2));
    await this.writeText(scope, "directory_context.md", this.directoryContext(vaultName, now, scope, files, mdFiles, inventoryRows, noteLinksAll, frontmatterAll, attachmentsAll, outlineAll, capRecords));

    await this.writeText(scope, "inventory_group_counts.csv", this.inventoryGroupCountsCsv(inventoryRows));
    await this.writeText(scope, "file_inventory_summary.md", this.fileInventorySummary(vaultName, now, scope, inventoryRows));
    await this.writeText(scope, "inventory_markdown.csv", this.csv(markdownInventory, this.inventoryHeader()));
    await this.writeText(scope, "inventory_code.csv", this.csv(codeInventory, this.inventoryHeader()));
    await this.writeText(scope, "inventory_data.csv", this.csv(dataInventory, this.inventoryHeader()));
    await this.writeText(scope, "inventory_documents_sample.csv", this.csv(documentInventory, this.inventoryHeader()));
    await this.writeText(scope, "inventory_media_sample.csv", this.csv(mediaInventory, this.inventoryHeader()));
    await this.writeText(scope, "inventory_other_sample.csv", this.csv(otherInventory, this.inventoryHeader()));

    await this.writeText(scope, "note_index.csv", this.noteIndexCsv(noteFiles));
    await this.writeText(scope, "markdown_outline.csv", this.markdownOutlineCsv(outlineRows));
    await this.writeText(scope, "markdown_outline_summary.md", this.markdownOutlineSummary(vaultName, now, scope, outlineAll, outlineRows));

    await this.writeText(scope, "note_link_graph.csv", this.noteLinkCsv(noteLinks));
    await this.writeText(scope, "note_link_graph_summary.md", this.noteLinkSummary(vaultName, now, scope, noteLinksAll, noteLinks));
    await this.writeText(scope, "backlink_summary.md", this.backlinkSummary(vaultName, now, scope, noteLinksAll));

    await this.writeText(scope, "frontmatter_index.csv", this.frontmatterCsv(frontmatterRows));
    await this.writeText(scope, "frontmatter_index_summary.md", this.frontmatterSummary(vaultName, now, scope, frontmatterAll, frontmatterRows));

    await this.writeText(scope, "attachment_reference_graph.csv", this.attachmentCsv(attachments));
    await this.writeText(scope, "attachment_reference_summary.md", this.attachmentSummary(vaultName, now, scope, attachmentsAll, attachments));

    await this.writeText(scope, "folder_tree_summary.md", this.folderTreeSummary(vaultName, now, scope, files));
    await this.writeText(scope, "large_index_notice.md", this.largeIndexNotice(vaultName, now, scope, capRecords));

    return {
      scope_type: scope.type,
      scope_path: scope.path,
      scope_slug: scope.slug,
      agent_context_location: scope.outDir,
      generated_at: now,
      total_files: files.length,
      markdown_notes: mdFiles.length,
      capped_outputs: capRecords.length,
    };
  }

  async writeText(scope: Scope, filename: string, content: string) {
    await this.app.vault.adapter.write(normalizePath(`${scope.outDir}/${filename}`), content);
  }

  inScope(file: TFile, scope: Scope): boolean {
    if (scope.type === "vault") return true;
    return normalizePath(file.path).startsWith(`${normalizePath(scope.path)}/`);
  }

  isGeneratedOrPluginFile(file: TFile): boolean {
    return file.path.startsWith(".agent_context/") || file.path.startsWith(".obsidian/");
  }

  pointerPaths(scope: Scope): { primary: string; fallback: string } {
    if (scope.type === "vault") {
      return { primary: "AGENTS.md", fallback: "AGENTS.agent-context-indexer.md" };
    }
    return {
      primary: normalizePath(`${scope.path}/AGENTS.md`),
      fallback: normalizePath(`${scope.path}/AGENTS.agent-context-indexer.md`),
    };
  }

  async writeFolderRegistry(results: ScopeResult[]) {
    await this.ensureFolder(".agent_context");
    const path = ".agent_context/folder_context_registry.csv";
    const existing = await this.readRegistry(path);
    const byScope = new Map<string, Row>();

    for (const row of existing) byScope.set(row.scope_path, row);

    for (const r of results) {
      if (r.scope_type !== "folder") continue;
      byScope.set(r.scope_path, {
        scope_path: r.scope_path,
        scope_slug: r.scope_slug,
        agent_context_location: r.agent_context_location,
        generated_at: r.generated_at,
        total_files: String(r.total_files),
        markdown_notes: String(r.markdown_notes),
        capped_outputs: String(r.capped_outputs),
      });
    }

    const rows = Array.from(byScope.values()).sort((a, b) =>
      a.scope_path.localeCompare(b.scope_path)
    );
    await this.app.vault.adapter.write(
      path,
      this.csv(rows, [
        "scope_path",
        "scope_slug",
        "agent_context_location",
        "generated_at",
        "total_files",
        "markdown_notes",
        "capped_outputs",
      ])
    );
  }

  async readRegistry(path: string): Promise<Row[]> {
    if (!(await this.app.vault.adapter.exists(path))) return [];
    try {
      return this.parseCsv(await this.app.vault.adapter.read(path));
    } catch {
      return [];
    }
  }

  parseCsv(content: string): Row[] {
    const lines = content.split(/\r?\n/).filter((x) => x.trim());
    if (lines.length < 2) return [];
    const header = this.parseCsvLine(lines[0]);
    return lines.slice(1).map((line) => {
      const values = this.parseCsvLine(line);
      const row: Row = {};
      header.forEach((h, i) => (row[h] = values[i] ?? ""));
      return row;
    });
  }

  parseCsvLine(line: string): string[] {
    const out: string[] = [];
    let cur = "";
    let quoted = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"' && quoted && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (c === '"') {
        quoted = !quoted;
      } else if (c === "," && !quoted) {
        out.push(cur);
        cur = "";
      } else {
        cur += c;
      }
    }
    out.push(cur);
    return out;
  }

  directoryContext(vault: string, at: string, scope: Scope, files: TFile[], md: TFile[], inv: Row[], links: Row[], fm: Row[], attach: Row[], outline: Row[], caps: CapRecord[]): string {
    const categoryCounts = this.countBy(inv, "file_category");
    const extCounts = this.countBy(inv, "extension");
    return `# Agent Context for ${vault}

Generated at: ${at}

## Scope

- Scope type: ${scope.type}
- Scope path: ${scope.path || "(vault root)"}
- Agent context location: ${scope.outDir}

## Purpose

This folder contains a breadth-first, metadata-first index for helping an AI agent navigate this Obsidian vault or folder scope.

The index is intentionally capped. It is not a full dump of the vault.

## Summary

- Total files in scope: ${files.length}
- Markdown notes in scope: ${md.length}
- Markdown headings in scope: ${outline.length}
- Wikilinks from scoped notes: ${links.length}
- Wikilinks with existing targets: ${this.countValue(links, "target_exists", "true")}
- Wikilinks with missing targets: ${this.countValue(links, "target_exists", "false")}
- Frontmatter rows: ${fm.length}
- Non-Markdown references from scoped notes: ${attach.length}
- Non-Markdown references with existing targets: ${this.countValue(attach, "target_exists", "true")}
- Non-Markdown references with missing targets: ${this.countValue(attach, "target_exists", "false")}
- Capped outputs: ${caps.length}

## File categories

${this.formatCounts(categoryCounts, 20)}

## Top extensions

${this.formatCounts(extCounts, 20)}

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

Vault-level context lives under \`.agent_context/latest/\`.

Folder-level contexts live under \`.agent_context/folders/<folder_slug>/latest/\`.

A registry of configured folder contexts may be available at \`.agent_context/folder_context_registry.csv\`.
`;
  }

  fileInventoryRows(files: TFile[]): Row[] {
    return files.map((f) => ({
      path: f.path,
      name: f.name,
      basename: f.basename,
      folder: f.parent?.path ?? "",
      extension: f.extension.toLowerCase(),
      size: String(f.stat.size),
      created_time: new Date(f.stat.ctime).toISOString(),
      modified_time: new Date(f.stat.mtime).toISOString(),
      file_category: this.classify(f.extension.toLowerCase()),
    }));
  }

  classify(ext: string): string {
    if (ext === "md" || ext === "markdown") return "markdown_note";
    if (CODE_EXT.has(ext)) return "code";
    if (DATA_EXT.has(ext)) return "data";
    if (DOC_EXT.has(ext)) return "document";
    if (MEDIA_EXT.has(ext)) return "media";
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

  inventoryGroupCountsCsv(rows: Row[]): string {
    const grouped = new Map<string, { count: number; size: number }>();
    for (const r of rows) {
      for (const key of [
        `file_category::${r.file_category}`,
        `extension::${r.extension || "(none)"}`,
        `folder::${r.folder || "(root)"}`,
      ]) {
        const cur = grouped.get(key) ?? { count: 0, size: 0 };
        cur.count += 1;
        cur.size += Number(r.size || "0");
        grouped.set(key, cur);
      }
    }
    const out = Array.from(grouped.entries()).map(([key, val]) => {
      const [group_type, group_value] = key.split("::");
      return {
        group_type,
        group_value,
        file_count: String(val.count),
        total_size_bytes: String(val.size),
      };
    });
    out.sort((a, b) =>
      a.group_type === b.group_type
        ? Number(b.file_count) - Number(a.file_count)
        : a.group_type.localeCompare(b.group_type)
    );
    return this.csv(out, ["group_type", "group_value", "file_count", "total_size_bytes"]);
  }

  fileInventorySummary(vault: string, at: string, scope: Scope, rows: Row[]): string {
    return `# File Inventory Summary

Vault: ${vault}

Generated at: ${at}

Scope type: ${scope.type}

Scope path: ${scope.path || "(vault root)"}

## Summary

- Total indexed files in scope: ${rows.length}
- Inventory files are split by category and capped to avoid large single files.
- Non-Markdown files are indexed by metadata only.

## File categories

${this.formatCounts(this.countBy(rows, "file_category"), 20)}

## Top extensions

${this.formatCounts(this.countBy(rows, "extension"), 30)}

## Top folders

${this.formatCounts(this.countBy(rows, "folder"), 30)}
`;
  }

  noteIndexCsv(files: TFile[]): string {
    const rows = files.map((f) => ({
      path: f.path,
      name: f.name,
      basename: f.basename,
      folder: f.parent?.path ?? "",
      extension: f.extension,
      size: String(f.stat.size),
      created_time: new Date(f.stat.ctime).toISOString(),
      modified_time: new Date(f.stat.mtime).toISOString(),
    }));
    return this.csv(rows, [
      "path",
      "name",
      "basename",
      "folder",
      "extension",
      "size",
      "created_time",
      "modified_time",
    ]);
  }

  async markdownOutlineRows(files: TFile[]): Promise<Row[]> {
    const rows: Row[] = [];
    for (const f of files) {
      const lines = (await this.app.vault.cachedRead(f)).split(/\r?\n/);
      let fenced = false;
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line.trim().startsWith("```")) {
          fenced = !fenced;
          continue;
        }
        if (fenced) continue;
        const m = /^(#{1,6})\s+(.+?)\s*$/.exec(line);
        if (!m) continue;
        rows.push({
          path: f.path,
          basename: f.basename,
          folder: f.parent?.path ?? "",
          heading_level: String(m[1].length),
          heading_text: m[2].trim(),
          line_number: String(i + 1),
        });
      }
    }
    return rows;
  }

  markdownOutlineCsv(rows: Row[]): string {
    return this.csv(rows, [
      "path",
      "basename",
      "folder",
      "heading_level",
      "heading_text",
      "line_number",
    ]);
  }

  markdownOutlineSummary(vault: string, at: string, scope: Scope, all: Row[], indexed: Row[]): string {
    return `# Markdown Outline Summary

Vault: ${vault}

Generated at: ${at}

Scope type: ${scope.type}

Scope path: ${scope.path || "(vault root)"}

## Summary

- Total headings found: ${all.length}
- Rows written to CSV: ${indexed.length}
- Notes with headings: ${this.countBy(all, "path").size}
- CSV capped: ${indexed.length < all.length ? "true" : "false"}

## Heading levels

${this.formatCounts(this.countBy(all, "heading_level"), 10)}

## Top notes by heading count

${this.formatCounts(this.countBy(all, "path"), 20)}
`;
  }

  async noteLinkRows(files: TFile[], pathSet: Set<string>, byName: Map<string, string[]>, scope: Scope): Promise<Row[]> {
    const rows: Row[] = [];
    for (const f of files) {
      const content = this.removeFencedCodeBlocks(await this.app.vault.cachedRead(f));
      const re = /\[\[([^\]]+)\]\]/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(content)) !== null) {
        const raw = m[1].trim();
        if (!raw) continue;
        const [targetPart, aliasPart] = raw.split("|");
        const target = targetPart.trim();
        const resolved = this.resolveMdTarget(target, pathSet, byName);
        rows.push({
          source_path: f.path,
          source_basename: f.basename,
          target_raw: target,
          target_note_guess: this.cleanNoteTarget(target),
          resolved_target_path: resolved.path,
          target_exists: resolved.exists,
          target_resolution_method: resolved.method,
          target_within_scope: this.pathInScope(resolved.path, scope),
          link_text: aliasPart ? aliasPart.trim() : target,
        });
      }
    }
    return rows;
  }

  resolveMdTarget(target: string, pathSet: Set<string>, byName: Map<string, string[]>): Resolved {
    const clean = this.cleanNoteTarget(target);
    const normalized = normalizePath(clean);
    const withMd = normalized.toLowerCase().endsWith(".md") ? normalized : `${normalized}.md`;

    if (pathSet.has(withMd)) {
      return { exists: "true", path: withMd, method: "exact_path" };
    }

    const direct = byName.get(normalized.toLowerCase()) ?? byName.get(withMd.toLowerCase());
    if (direct?.length === 1) return { exists: "true", path: direct[0], method: "unique_name" };
    if (direct && direct.length > 1) {
      return { exists: "ambiguous", path: direct.join("; "), method: "multiple_name_matches" };
    }

    const base = normalizePath(normalized.split("/").pop() ?? normalized).toLowerCase().replace(/\.md$/i, "");
    const baseMatches = byName.get(base) ?? byName.get(`${base}.md`);
    if (baseMatches?.length === 1) return { exists: "true", path: baseMatches[0], method: "unique_basename" };
    if (baseMatches && baseMatches.length > 1) {
      return { exists: "ambiguous", path: baseMatches.join("; "), method: "multiple_basename_matches" };
    }

    return { exists: "false", path: "", method: "not_found" };
  }

  cleanNoteTarget(target: string): string {
    return normalizePath(target.split("#")[0].split("?")[0].trim());
  }

  noteLinkCsv(rows: Row[]): string {
    return this.csv(rows, [
      "source_path",
      "source_basename",
      "target_raw",
      "target_note_guess",
      "resolved_target_path",
      "target_exists",
      "target_resolution_method",
      "target_within_scope",
      "link_text",
    ]);
  }

  noteLinkSummary(vault: string, at: string, scope: Scope, all: Row[], indexed: Row[]): string {
    return `# Note Link Graph Summary

Vault: ${vault}

Generated at: ${at}

Scope type: ${scope.type}

Scope path: ${scope.path || "(vault root)"}

## Summary

- Total wikilinks found: ${all.length}
- Wikilinks written to CSV: ${indexed.length}
- Notes with outgoing links: ${this.countBy(all, "source_path").size}
- Unique link targets: ${this.countBy(all, "target_raw").size}
- CSV capped: ${indexed.length < all.length ? "true" : "false"}

## Target existence

${this.formatCounts(this.countBy(all, "target_exists"), 10)}

## Target within scope

${this.formatCounts(this.countBy(all, "target_within_scope"), 10)}

## Resolution methods

${this.formatCounts(this.countBy(all, "target_resolution_method"), 20)}

## Top notes by outgoing links

${this.formatCounts(this.countBy(all, "source_path"), 20)}

## Top link targets

${this.formatCounts(this.countBy(all, "target_raw"), 20)}
`;
  }

  backlinkSummary(vault: string, at: string, scope: Scope, rows: Row[]): string {
    const incoming = new Map<string, number>();
    const outgoing = new Map<string, number>();
    const broken = rows.filter((r) => r.target_exists === "false");
    const ambiguous = rows.filter((r) => r.target_exists === "ambiguous");

    for (const r of rows) {
      outgoing.set(r.source_path, (outgoing.get(r.source_path) ?? 0) + 1);
      const target = r.resolved_target_path || r.target_raw;
      incoming.set(target, (incoming.get(target) ?? 0) + 1);
    }

    const hubs = Array.from(incoming.entries())
      .map(([path, inc]) => ({ path, inc, out: outgoing.get(path) ?? 0 }))
      .sort((a, b) => b.inc + b.out - (a.inc + a.out))
      .slice(0, 20);

    return `# Backlink Summary

Vault: ${vault}

Generated at: ${at}

Scope type: ${scope.type}

Scope path: ${scope.path || "(vault root)"}

## Summary

- Total wikilinks from scoped notes: ${rows.length}
- Broken note links: ${broken.length}
- Ambiguous note links: ${ambiguous.length}
- Notes or targets with incoming links: ${incoming.size}
- Notes with outgoing links: ${outgoing.size}

## Top incoming-link targets

${this.formatCounts(incoming, 20)}

## Top outgoing-link notes

${this.formatCounts(outgoing, 20)}

## Potential hub notes

${hubs.length ? hubs.map((h) => `- ${h.path}: incoming ${h.inc}, outgoing ${h.out}`).join("\n") : "- None"}

## Broken link examples

${broken.length ? broken.slice(0, 20).map((r) => `- ${r.source_path} -> ${r.target_raw}`).join("\n") : "- None"}

## Ambiguous link examples

${ambiguous.length ? ambiguous.slice(0, 20).map((r) => `- ${r.source_path} -> ${r.target_raw}`).join("\n") : "- None"}
`;
  }

  frontmatterRows(files: TFile[]): Row[] {
    return files.map((f) => {
      const cache = this.app.metadataCache.getFileCache(f);
      const frontmatter = cache?.frontmatter ?? {};
      return {
        path: f.path,
        basename: f.basename,
        folder: f.parent?.path ?? "",
        has_frontmatter: Object.keys(frontmatter).length > 0 ? "true" : "false",
        tags: this.extractTags(cache).join("; "),
        type: this.stringify(frontmatter["type"]),
        status: this.stringify(frontmatter["status"]),
        title: this.stringify(frontmatter["title"]),
        date: this.stringify(frontmatter["date"]),
      };
    });
  }

  extractTags(cache: CachedMetadata | null): string[] {
    const tags = new Set<string>();

    if (cache?.tags) {
      for (const t of cache.tags) {
        const tag = t.tag.replace(/^#/, "").trim();
        if (tag && !this.looksLikeHexColor(tag)) tags.add(tag);
      }
    }

    const fmTags = cache?.frontmatter?.["tags"];
    if (Array.isArray(fmTags)) {
      for (const t of fmTags) {
        const tag = String(t).replace(/^#/, "").trim();
        if (tag && !this.looksLikeHexColor(tag)) tags.add(tag);
      }
    } else if (typeof fmTags === "string") {
      for (const t of fmTags.split(",")) {
        const tag = t.replace(/^#/, "").trim();
        if (tag && !this.looksLikeHexColor(tag)) tags.add(tag);
      }
    }

    return Array.from(tags).sort();
  }

  looksLikeHexColor(value: string): boolean {
    return /^[0-9A-Fa-f]{3}$|^[0-9A-Fa-f]{6}$/.test(value);
  }

  stringify(value: unknown): string {
    if (value === null || value === undefined) return "";
    if (Array.isArray(value)) return value.map((x) => String(x)).join("; ");
    return String(value);
  }

  frontmatterCsv(rows: Row[]): string {
    return this.csv(rows, [
      "path",
      "basename",
      "folder",
      "has_frontmatter",
      "tags",
      "type",
      "status",
      "title",
      "date",
    ]);
  }

  frontmatterSummary(vault: string, at: string, scope: Scope, all: Row[], indexed: Row[]): string {
    const tagCounts = new Map<string, number>();
    const typeCounts = new Map<string, number>();
    const statusCounts = new Map<string, number>();

    for (const r of all) {
      for (const tag of r.tags.split(";").map((x) => x.trim()).filter(Boolean)) {
        tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
      }
      if (r.type) typeCounts.set(r.type, (typeCounts.get(r.type) ?? 0) + 1);
      if (r.status) statusCounts.set(r.status, (statusCounts.get(r.status) ?? 0) + 1);
    }

    return `# Frontmatter Index Summary

Vault: ${vault}

Generated at: ${at}

Scope type: ${scope.type}

Scope path: ${scope.path || "(vault root)"}

## Summary

- Total notes in scope: ${all.length}
- Rows written to CSV: ${indexed.length}
- Notes with frontmatter: ${this.countValue(all, "has_frontmatter", "true")}
- Notes with tags: ${all.filter((r) => r.tags !== "").length}
- Unique tags: ${tagCounts.size}
- Unique type values: ${typeCounts.size}
- Unique status values: ${statusCounts.size}
- CSV capped: ${indexed.length < all.length ? "true" : "false"}

## Top tags

${this.formatCounts(tagCounts, 20)}

## Type values

${this.formatCounts(typeCounts, 20)}

## Status values

${this.formatCounts(statusCounts, 20)}
`;
  }

  filesByName(files: TFile[]): Map<string, string[]> {
    const map = new Map<string, string[]>();
    for (const f of files) {
      const norm = normalizePath(f.path);
      for (const name of new Set([f.name, f.basename, f.path, norm])) {
        const key = normalizePath(name).toLowerCase();
        const cur = map.get(key) ?? [];
        cur.push(norm);
        map.set(key, cur);
      }
    }
    return map;
  }

  async attachmentRows(files: TFile[], pathSet: Set<string>, byName: Map<string, string[]>, scope: Scope): Promise<Row[]> {
    const rows: Row[] = [];
    for (const f of files) {
      const content = this.removeFencedCodeBlocks(await this.app.vault.cachedRead(f));

      const wiki = /(!)?\[\[([^\]]+)\]\]/g;
      let m: RegExpExecArray | null;
      while ((m = wiki.exec(content)) !== null) {
        const targetText = m[2].trim();
        if (!targetText) continue;
        const [targetPart, aliasPart] = targetText.split("|");
        const target = targetPart.trim();
        const ext = this.extension(target);
        if (!ext || !ATTACHMENT_EXT.has(ext)) continue;
        const resolved = this.resolveTarget(target, pathSet, byName);
        rows.push({
          source_note_path: f.path,
          source_note_basename: f.basename,
          target_raw: target,
          target_path_guess: normalizePath(target),
          resolved_target_path: resolved.path,
          target_exists: resolved.exists,
          target_resolution_method: resolved.method,
          target_within_scope: this.pathInScope(resolved.path, scope),
          target_extension: ext,
          reference_type: m[1] === "!" ? "embed" : "wikilink",
          link_text: aliasPart ? aliasPart.trim() : target,
        });
      }

      const md = /(!)?\[([^\]]*)\]\(([^)]+)\)/g;
      while ((m = md.exec(content)) !== null) {
        const target = m[3].trim();
        const ext = this.extension(target);
        if (!ext || !ATTACHMENT_EXT.has(ext)) continue;
        const resolved = this.resolveTarget(target, pathSet, byName);
        rows.push({
          source_note_path: f.path,
          source_note_basename: f.basename,
          target_raw: target,
          target_path_guess: normalizePath(target),
          resolved_target_path: resolved.path,
          target_exists: resolved.exists,
          target_resolution_method: resolved.method,
          target_within_scope: this.pathInScope(resolved.path, scope),
          target_extension: ext,
          reference_type: m[1] === "!" ? "markdown_embed" : "markdown_link",
          link_text: m[2].trim() || target,
        });
      }
    }
    return rows;
  }

  resolveTarget(target: string, pathSet: Set<string>, byName: Map<string, string[]>): Resolved {
    const clean = normalizePath(target.split("#")[0].split("?")[0].trim());
    if (pathSet.has(clean)) return { exists: "true", path: clean, method: "exact_path" };

    const direct = byName.get(clean.toLowerCase());
    if (direct?.length === 1) return { exists: "true", path: direct[0], method: "unique_name" };
    if (direct && direct.length > 1) {
      return { exists: "ambiguous", path: direct.join("; "), method: "multiple_name_matches" };
    }

    const file = normalizePath(clean.split("/").pop() ?? clean).toLowerCase();
    const filename = byName.get(file);
    if (filename?.length === 1) return { exists: "true", path: filename[0], method: "unique_filename" };
    if (filename && filename.length > 1) {
      return { exists: "ambiguous", path: filename.join("; "), method: "multiple_filename_matches" };
    }

    return { exists: "false", path: "", method: "not_found" };
  }

  extension(path: string): string {
    const clean = path.split("#")[0].split("?")[0].trim();
    const last = clean.split("/").pop() ?? clean;
    const parts = last.split(".");
    return parts.length < 2 ? "" : parts[parts.length - 1].toLowerCase();
  }

  pathInScope(path: string, scope: Scope): string {
    if (!path) return "";
    if (scope.type === "vault") return "true";
    return normalizePath(path).startsWith(`${normalizePath(scope.path)}/`) ? "true" : "false";
  }

  attachmentCsv(rows: Row[]): string {
    return this.csv(rows, [
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
    ]);
  }

  attachmentSummary(vault: string, at: string, scope: Scope, all: Row[], indexed: Row[]): string {
    return `# Attachment Reference Summary

Vault: ${vault}

Generated at: ${at}

Scope type: ${scope.type}

Scope path: ${scope.path || "(vault root)"}

## Summary

- Total attachment / non-Markdown references found: ${all.length}
- Rows written to CSV: ${indexed.length}
- CSV capped: ${indexed.length < all.length ? "true" : "false"}

## Target existence

${this.formatCounts(this.countBy(all, "target_exists"), 10)}

## Target within scope

${this.formatCounts(this.countBy(all, "target_within_scope"), 10)}

## Resolution methods

${this.formatCounts(this.countBy(all, "target_resolution_method"), 20)}

## Referenced file extensions

${this.formatCounts(this.countBy(all, "target_extension"), 30)}

## Reference types

${this.formatCounts(this.countBy(all, "reference_type"), 20)}

## Top source notes

${this.formatCounts(this.countBy(all, "source_note_path"), 20)}
`;
  }

  folderTreeSummary(vault: string, at: string, scope: Scope, files: TFile[]): string {
    const counts = new Map<string, number>();
    for (const f of files) {
      const folder = f.parent?.path ?? "";
      const parts = folder ? folder.split("/") : [];
      for (let d = 0; d <= Math.min(parts.length, CAPS.folderTreeDepth); d++) {
        const key = d === 0 ? "(root)" : parts.slice(0, d).join("/");
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
    }
    const rows = Array.from(counts.entries())
      .map(([folder, count]) => ({
        folder,
        count,
        depth: folder === "(root)" ? 0 : folder.split("/").length,
      }))
      .sort((a, b) => (a.depth === b.depth ? a.folder.localeCompare(b.folder) : a.depth - b.depth))
      .slice(0, CAPS.folderTreeRows);

    return `# Folder Tree Summary

Vault: ${vault}

Generated at: ${at}

Scope type: ${scope.type}

Scope path: ${scope.path || "(vault root)"}

## Summary

- Max displayed depth: ${CAPS.folderTreeDepth}
- Max displayed rows: ${CAPS.folderTreeRows}
- Rows displayed: ${rows.length}
- This is a folder-level overview, not a full file listing.

## Folder overview

${rows.length ? rows.map((r) => `${"  ".repeat(r.depth)}- ${r.folder}: ${r.count} files`).join("\n") : "- None"}
`;
  }

  largeIndexNotice(vault: string, at: string, scope: Scope, caps: CapRecord[]): string {
    return `# Large Index Notice

Vault: ${vault}

Generated at: ${at}

Scope type: ${scope.type}

Scope path: ${scope.path || "(vault root)"}

## Summary

- Capped outputs: ${caps.length}
- The index is intentionally capped to keep files agent-readable.
- A capped output is not a complete dump.

## Capped outputs

${caps.length ? caps.map((r) => `- ${r.output}: wrote ${r.indexed_rows} of ${r.total_rows} rows, cap ${r.cap}`).join("\n") : "- None"}

## Recommended behavior for agents

When an output is capped, do not assume it contains every matching item.

Use the capped output for breadth-first navigation. Then read original source files only after choosing a small number of likely relevant candidates.

For very large vaults or broad root scans, ask the user to run folder-level Agent Context generation on a narrower folder if more focused context is needed.
`;
  }

  async writeSafeAgentPointer(primary: string, fallback: string, content: string): Promise<Row> {
    if (!(await this.app.vault.adapter.exists(primary))) {
      await this.app.vault.adapter.write(primary, content);
      return {
        status: "created_primary",
        primary_path: primary,
        fallback_path: "",
        message: "AGENTS.md did not exist, so the plugin created it.",
      };
    }

    await this.app.vault.adapter.write(fallback, content);
    return {
      status: "created_fallback_existing_primary",
      primary_path: primary,
      fallback_path: fallback,
      message:
        "AGENTS.md already existed, so the plugin left it unchanged and created AGENTS.agent-context-indexer.md. User or agent can merge manually.",
    };
  }

  agentPointerContent(scope: Scope): string {
    const label =
      scope.type === "vault"
        ? "This vault uses Agent Context Indexing."
        : `This folder uses a folder-level Agent Context Index for scope: ${scope.path}`;

    return `# Agent Context Index

${label}

Before exploring this ${scope.type === "vault" ? "vault" : "folder"} directly, read:

\`${scope.outDir}/agent_context_manifest.json\`

Recommended workflow:

1. Read \`${scope.outDir}/agent_context_manifest.json\`.
2. Read \`${scope.outDir}/directory_context.md\`.
3. Read \`${scope.outDir}/large_index_notice.md\`.
4. Read \`${scope.outDir}/folder_tree_summary.md\`.
5. Read \`${scope.outDir}/file_inventory_summary.md\`.
6. Read \`${scope.outDir}/inventory_group_counts.csv\`.
7. Use the category-specific inventory files only as needed.
8. Use \`${scope.outDir}/note_index.csv\`, \`${scope.outDir}/markdown_outline.csv\`, \`${scope.outDir}/note_link_graph.csv\`, \`${scope.outDir}/backlink_summary.md\`, and \`${scope.outDir}/frontmatter_index.csv\` for note navigation.
9. Use \`${scope.outDir}/attachment_reference_graph.csv\` to understand references from notes to PDFs, images, data files, and other non-Markdown files.
10. Prefer rows where target_exists is true before trying to read original files.
11. Read original source files only after selecting a small number of relevant candidates.

Important notes:

- The index is breadth-first and metadata-first.
- The index is intentionally capped to avoid large single files.
- Non-Markdown files are indexed by metadata only.
- If this file was generated as AGENTS.agent-context-indexer.md, an existing AGENTS.md was not overwritten. Merge manually if desired.
- If the index looks stale, ask the user to rerun the appropriate Agent Context command in Obsidian.
`;
  }

  csv(rows: Row[], header: string[]): string {
    return [header.join(","), ...rows.map((r) => header.map((h) => this.escapeCsv(r[h] ?? "")).join(","))].join("\n");
  }

  countBy(rows: Row[], field: string): Map<string, number> {
    const counts = new Map<string, number>();
    for (const r of rows) {
      const value = r[field] || "(blank)";
      counts.set(value, (counts.get(value) ?? 0) + 1);
    }
    return counts;
  }

  countValue(rows: Row[], field: string, value: string): number {
    return rows.filter((r) => r[field] === value).length;
  }

  formatCounts(counts: Map<string, number>, limit: number): string {
    const rows = Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit);
    return rows.length ? rows.map(([k, v]) => `- ${k}: ${v}`).join("\n") : "- None";
  }

  limit<T>(rows: T[], cap: number, output: string, caps: CapRecord[]): T[] {
    if (rows.length > cap) {
      caps.push({
        output,
        total_rows: rows.length,
        indexed_rows: cap,
        cap,
      });
    }
    return rows.slice(0, cap);
  }

  removeFencedCodeBlocks(content: string): string {
    return content.replace(/```[\s\S]*?```/g, "");
  }

  escapeCsv(value: string): string {
    return value.includes(",") || value.includes('"') || value.includes("\n")
      ? `"${value.replace(/"/g, '""')}"`
      : value;
  }

  async ensureFolder(folderPath: string) {
    const parts = normalizePath(folderPath).split("/");
    let current = "";
    for (const part of parts) {
      current = current ? `${current}/${part}` : part;
      if (!(await this.app.vault.adapter.exists(current))) {
        await this.app.vault.adapter.mkdir(current);
      }
    }
  }

  onunload() {
    console.log("Unloading Obsidian Agent Context plugin");
  }
}

class AgentContextSettingTab extends PluginSettingTab {
  plugin: ObsidianAgentContextPlugin;

  constructor(app: App, plugin: ObsidianAgentContextPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "Obsidian Agent Context Settings" });

    new Setting(containerEl)
      .setName("Folder scopes")
      .setDesc("One folder path per line. These folders can be indexed separately for lower-noise folder-level context.")
      .addTextArea((text) => {
        text
          .setPlaceholder("Projects/FrameAxis\nLiterature\nResearch/Papers")
          .setValue(this.plugin.settings.folderScopePaths)
          .onChange(async (value) => {
            this.plugin.settings.folderScopePaths = value;
            await this.plugin.saveSettings();
          });
        text.inputEl.rows = 8;
        text.inputEl.cols = 42;
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
