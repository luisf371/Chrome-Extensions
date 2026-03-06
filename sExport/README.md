# sExport Tabs (Chrome Extension, MV3)

Exports all currently-open tabs to a plain text file (grouped by **window** and **tab group**) and can later import that file to restore the windows/groups in a new session.

## Install (Load Unpacked)

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked**
4. Select this folder: `D:\Chrome Extensions\sExport`

## Use

- Click the extension icon → **Download tabs.txt**
  - A save dialog will prompt you where to save.
- Click the extension icon → choose the exported `.txt` file → **Restore windows**
  - Restores into **new** windows (does not close your current ones).

## Notes / limitations

- Some URLs can’t be restored by extensions (for example `chrome://…`, `devtools://…`, `chrome-extension://…`). Those tabs are skipped during restore.
- Tab groups are recreated (title/color/collapsed) for restoreable tabs.

## Export file format (v1)

The exported file is tab-separated with these record types:

- `WINDOW <type> <focused>`
- `GROUP <groupId|-1> <color|none> <collapsed> <title_enc>`
- `TAB <pinned> <url> <title_enc>`

`title_enc` fields are `encodeURIComponent(...)` encoded.

