# Project memory

## 2026-03-04
- Built a Manifest V3 popup extension to export all open tabs grouped by window + tab group into a TSV-like `.txt` download (`saveAs: true`).
- Added restore/import: select the exported `.txt` in the popup to recreate windows/tabs/groups; skips internal URLs like `chrome://` that extensions can’t open.
- Export format is stable + parseable (`sExport\ttabs\tv1` header; `WINDOW`/`GROUP`/`TAB` lines; titles are URI-encoded; URLs are raw).
- Fixed export truncation risk by switching download generation from a huge percent-encoded `data:` URL to a `blob:` URL (with base64 `data:` fallback), and exporting `tab.pendingUrl` when available.

## 2026-03-05
- Review pass: repo is a minimal MV3 popup extension (manifest.json, popup.html, popup.css, popup.js) with no package.json/build tooling; quick syntax check passes with 
ode --check .\\popup.js.
- 2026-03-05: Starting parser hardening work; focus is parseExportTxt() accepting malformed lines too quietly during restore.
- 2026-03-05: Hardened parseExportTxt() to reject malformed imports with line-numbered errors for bad field counts, invalid booleans, bad group IDs, unknown record types, empty URLs, and broken URI-encoded titles.
- 2026-03-05: Adding a restore preview/confirmation step before any Chrome windows or tabs are created from an import file.
- 2026-03-05: Restore flow now parses once for a preview summary and asks for confirmation before creating any windows/tabs; status text shows the same counts before restore starts.
- 2026-03-05: Follow-up cleanup: preview summary now passes the already-parsed window spec into restore so the import file is validated once before confirmation, not parsed twice.
