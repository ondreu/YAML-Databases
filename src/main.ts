import { Notice, Plugin, TFile, TFolder, normalizePath } from "obsidian";
import {
	VIEW_TYPE_YAML,
	YAML_EXTENSIONS,
	YAML_MD_SUFFIX,
	isYamlDbFile,
	ICONS,
} from "./constants";
import { YamlView } from "./view/YamlView";
import {
	DEFAULT_SETTINGS,
	YamlDatabasesSettings,
	YamlDatabasesSettingTab,
} from "./settings";

export default class YamlDatabasesPlugin extends Plugin {
	settings!: YamlDatabasesSettings;

	async onload(): Promise<void> {
		await this.loadSettings();

		// Log the running version so the console makes it obvious which build is
		// active (useful when checking whether a beta update actually landed).
		console.log(`YAML Databases ${this.manifest.version} loaded`);

		this.registerView(VIEW_TYPE_YAML, (leaf) => new YamlView(leaf, this));

		// Own `.yaml` / `.yml` directly so clicking them opens our view. If another
		// plugin already registered these extensions we silently fall back to the
		// command below; the file-open hijack is not needed for these.
		try {
			this.registerExtensions(YAML_EXTENSIONS, VIEW_TYPE_YAML);
		} catch (e) {
			console.warn(
				"YAML Databases: could not register .yaml/.yml extensions",
				e
			);
		}

		// `.yaml.md` files are Markdown notes to Obsidian, so we cannot own the
		// extension via registerExtensions. Two strategies cooperate to make sure
		// such a file never stays in the default Markdown view:
		//
		//  1. `file-open`: fires when a file is opened; we attempt an immediate
		//     swap of the active leaf if it is the built-in Markdown view.
		//  2. `layout-change` (debounced): fires after the workspace fully settles
		//     (view swaps, drag-drop, workspace restore). We scan every Markdown
		//     leaf and convert any showing a `.yaml.md` file. This catches cases
		//     where the file-open timing was wrong, and is what makes the hijack
		//     reliable in practice.
		this.registerEvent(
			this.app.workspace.on("file-open", (file: TFile | null) => {
				if (!file || !isYamlDbFile(file.path)) return;
				this.hijackActiveIfMarkdown(file.path);
			})
		);

		const scan = this.scanAndHijack.bind(this);
		this.registerEvent(this.app.workspace.on("layout-change", scan));
		// Run once after the workspace is ready so leaves restored from the last
		// session are converted too.
		this.app.workspace.onLayoutReady(() => scan());

		// "New YAML database" in the folder context menu.
		this.registerEvent(
			this.app.workspace.on("file-menu", (menu, file) => {
				if (!(file instanceof TFolder)) {
					return;
				}
				menu.addItem((item) =>
					item
						.setTitle("New YAML database")
						.setIcon(ICONS.create)
						.onClick(() => this.createDatabase(file))
				);
			})
		);

		// Command-palette equivalent (creates next to the active file, else root).
		this.addCommand({
			id: "create-yaml-database",
			name: "Create new YAML database",
			callback: () => this.createDatabase(this.currentFolder()),
		});

		// Force the active YAML file open in our view, even if another plugin
		// or the default Markdown view grabbed it. Essential on mobile where
		// clicking the file may route elsewhere.
		this.addCommand({
			id: "open-in-yaml-databases",
			name: "Open current file in YAML Databases",
			checkCallback: (checking: boolean) => {
				const file = this.app.workspace.getActiveFile();
				const eligible = !!file && isYamlDbFile(file.path);
				if (eligible && !checking) {
					void this.openInYamlView(file as TFile);
				}
				return eligible;
			},
		});

		this.addRibbonIcon(ICONS.create, "Create YAML database", () => {
			this.createDatabase(this.currentFolder());
		});

		this.addSettingTab(new YamlDatabasesSettingTab(this.app, this));
	}

	async loadSettings(): Promise<void> {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}

	/**
	 * Try to swap the currently active leaf to our view if it is the built-in
	 * Markdown view showing `path`. Synchronous, best-effort; the layout-change
	 * scanner is the reliable backstop.
	 */
	private hijackActiveIfMarkdown(path: string): void {
		const leaf = this.app.workspace.getLeaf(false);
		const view = leaf?.view;
		if (!view) return;
		if (view.getViewType?.() !== "markdown") return;
		const f = (view as { file?: TFile } | null)?.file;
		if (f && f.path === path) {
			void leaf!.setViewState({
				type: VIEW_TYPE_YAML,
				state: { file: path },
				active: true,
			});
		}
	}

	/**
	 * Scan every open Markdown leaf and convert any that is showing a
	 * `.yaml.md` file into the YAML Databases view. Only the built-in
	 * `markdown` view is touched, so files opened by other plugins are left
	 * alone. Leaves already in our view are skipped (loop guard).
	 */
	private scanAndHijack(): void {
		const leaves = this.app.workspace.getLeavesOfType("markdown");
		for (const leaf of leaves) {
			const f = (leaf.view as { file?: TFile } | null)?.file;
			if (f && isYamlDbFile(f.path)) {
				void leaf.setViewState({
					type: VIEW_TYPE_YAML,
					state: { file: f.path },
					active: true,
				});
			}
		}
	}

	/** Create a new YAML database in `folder` and open it in the main area. */
	private async createDatabase(folder: TFolder): Promise<void> {
		try {
			const path = this.uniquePath(folder, this.settings.newFileBaseName);
			const file = await this.app.vault.create(
				path,
				this.settings.newFileTemplate
			);
			await this.openInYamlView(file);
		} catch (e) {
			new Notice(
				`YAML Databases: could not create file: ${e instanceof Error ? e.message : String(e)}`
			);
		}
	}

	/** Open a file in our YAML view regardless of extension ownership. */
	private async openInYamlView(file: TFile): Promise<void> {
		const leaf = this.app.workspace.getLeaf(false);
		await leaf.setViewState({
			type: VIEW_TYPE_YAML,
			state: { file: file.path },
			active: true,
		});
	}

	/** Folder of the active file, or the vault root. */
	private currentFolder(): TFolder {
		const active = this.app.workspace.getActiveFile();
		if (active?.parent) {
			return active.parent;
		}
		return this.app.vault.getRoot();
	}

	/** First non-colliding path like `<folder>/<base>.yaml.md`, `<base> 1.yaml.md`. */
	private uniquePath(folder: TFolder, base: string): string {
		const dir = folder.isRoot() ? "" : `${folder.path}/`;
		for (let i = 0; i < 1000; i++) {
			const name = i === 0 ? base : `${base} ${i}`;
			const candidate = normalizePath(`${dir}${name}${YAML_MD_SUFFIX}`);
			if (!this.app.vault.getAbstractFileByPath(candidate)) {
				return candidate;
			}
		}
		// Extremely unlikely fallback.
		return normalizePath(`${dir}${base} ${Date.now()}${YAML_MD_SUFFIX}`);
	}
}
