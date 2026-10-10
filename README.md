# WPM RT

Realtime typing speed for Obsidian.

WPM RT adds a `wpm: N` item to Obsidian's status bar and tracks typing speed from actual editor changes. The stats view shows the current document, global totals, and per-note history.

## Features

- Realtime WPM in the status bar.
- Current document stats: words typed, characters typed, average WPM, active time, and bursts.
- Global stats across the vault.
- Per-note stats table.
- Active-time tracking that counts short pauses but discards longer idle gaps.
- Filters navigation, shortcuts, deletes, undo/redo, paste, and large bulk edits.

## Development

Install dependencies and build:

```bash
npm install
npm run build
```

With Nix:

```bash
nix develop path:.
npm install
npm run build
```

For live development:

```bash
npm run dev
```

Install the built plugin into a local vault:

```bash
scripts/install-obsidian-plugin /path/to/YourVault
```

Then reload Obsidian and enable **WPM RT** in Community plugins.

## Release

Build before creating a GitHub release:

```bash
npm run build
gh release create 0.1.0 main.js manifest.json styles.css --title "0.1.0" --notes "Initial release."
```

The release tag must match `manifest.json`'s `version`.
