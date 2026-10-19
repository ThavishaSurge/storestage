# Theme write exemption — request draft

Submit Shopify's **Online Store Protected Scope Exemption Request** form once per app (development, staging and production
apps are separate requests). An App Store URL isn't required yet; a note that the app isn't listed is reported to be fine.
Attach a short screen recording of Theme Compare: pick two themes, review conflicts, apply.

---

**App name:** StoreStage

**Scopes / APIs requested:** `write_themes` — `themeFilesUpsert`, `themeFilesDelete`, `themeDuplicate`

**Exemption categories:** Developer tooling and testing functionality; Backups

**Use case**

StoreStage is a staging and merge tool for theme developers and agencies. A common situation: an agency duplicates a
merchant's live theme to build a redesign while the merchant keeps editing the live theme in the theme editor. When the
redesign is ready, publishing it would silently discard the merchant's edits.

StoreStage compares the two themes against a snapshot taken when the copy was made, merges theme-editor JSON key by key
and Liquid/CSS/JS line by line, and shows the merchant or developer every conflict to decide. It then writes the merged
files into the **unpublished working copy**, so nothing the merchant changed is lost when they publish it.

For agencies with a staging store, StoreStage promotes theme changes from staging to live by duplicating the live theme
and writing the merged files into the duplicate. The merchant previews and publishes it themselves.

**Why theme app extensions don't fit**

The app's core function is to edit existing theme files (layout, templates, sections, snippets, `settings_data.json`)
on behalf of the merchant to reconcile two versions of the same theme. App blocks and app embeds add app-owned content
alongside a theme; they can't modify existing theme code or settings, so they can't perform a merge.

**Safeguards**

- Never writes to the published theme. Writes only go to an unpublished working copy or to a fresh duplicate of the
  live theme.
- Snapshots every target theme before writing and keeps the snapshot so changes can be restored.
- Every write is explicitly triggered by a staff member after reviewing a file-by-file diff; nothing runs automatically.
- Writes are limited to the files that differ; unchanged files are never touched.
- Doesn't distribute themes or create themes from external sources.
