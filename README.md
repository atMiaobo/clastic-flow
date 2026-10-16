### clastic flow
a minimalist lightweight real-time wpm monitor for Obsidian with stats dashboard.

Clastic Flow is a lightweight Obsidian plugin that shows your typing speed in real time while you're editing your notes. Additionally for thou scholarly goblins, Clastic Flow aggregates your typing statistics per document using a more sophisticated method than the naive troglodyte pea-sized homoheidelbergensis chaff filled brain approach, actively monitoring only the active typing sessions. Review your aggregate statistics across all notes and individual notes.

### How it works 

Clastic Flow adds a `wpm: N` item to Obsidian's status bar and tracks typing speed from actual editor changes. The stats view shows the current document, global totals, and per-note history.

#### Features

- Realtime WPM in the status bar.
- Current document stats: words typed, characters typed, average WPM, active time, and bursts.
- Global stats across the vault.
- Per-note stats table.
- Active-time tracking that counts short pauses but discards longer idle gaps.
- Filters navigation, shortcuts, deletes, undo/redo, paste, and large bulk edits.
### The logic

Clastic Flow measures typing from CodeMirror editor transactions rather than from wall-clock time in a note. That means it only reacts when the document actually changes, so moving the cursor, using arrow keys, switching panes, opening command palette actions, or sitting on a note without typing will not count as typing time.

Live WPM uses a short rolling window:

```text
seconds = clamp(now - first_change_in_window, min = 1.0s, max = rolling_window)
characters_per_second = inserted_characters_in_window / seconds
wpm = characters_per_second * 60 / average_word_length
```

The default rolling window is `2000ms` and the default average word length is `4.8` characters. This keeps the status bar responsive without letting a single keypress create absurd instant WPM spikes.

Aggregate stats use active typing time. When you type in a note, Clastic Flow compares the new edit to the previous edit for that note:

- If the gap is within the pause grace window, the gap counts as active typing time.
- If the gap is longer than the pause grace window, the gap is discarded and a new burst begins.
- The default pause grace is `5000ms`, so short thinking pauses are included, but long idle periods do not dilute your average.

This avoids the naive calculation of total words divided by total time spent with a document open. A note can sit open for hours without damaging its average WPM; only active typing bursts matter.

The plugin also ignores edits that are unlikely to represent normal typing:

- Deletes and undo/redo operations.
- Navigation-only actions.
- Pasted or bulk-inserted text above the configured character threshold.
- Large autocomplete or generated insertions, unless you raise the threshold in settings.

### Setup

#### From the Obsidian community plugin store

Once Clastic Flow is accepted into the community plugin directory:

1. Open `Settings -> Community plugins` in Obsidian.
2. Disable restricted mode if needed.
3. Browse community plugins and search for `Clastic Flow`.
4. Install and enable the plugin.

#### Manual installation

Download the latest release files from GitHub:

- `main.js`
- `manifest.json`
- `styles.css`

Create this folder in your vault:

```text
YourVault/.obsidian/plugins/clastic-flow/
```

Put the three release files in that folder, then reload Obsidian and enable `Clastic Flow` from `Settings -> Community plugins`.

#### Building from source

```bash
npm install
npm run build
```

For Nix users:

```bash
nix develop path:.
npm install
npm run build
```

To install a local build into a vault:

```bash
scripts/install-obsidian-plugin /path/to/YourVault
```

### Release

Releases are built by GitHub Actions so the uploaded assets have artifact attestations.

1. Bump the same version in `manifest.json`, `package.json`, and `package-lock.json`.
2. Commit and push the change.
3. Create a GitHub release with a tag exactly matching `manifest.json`'s version.

```bash
gh release create 0.1.5 --title "0.1.5" --notes "Release notes here."
```

Do not upload `main.js`, `manifest.json`, or `styles.css` manually. The release workflow builds, attests, and uploads those files.

### Gallery

<img width="2529" height="1508" alt="image" src="https://github.com/user-attachments/assets/ba267b8a-1351-44fd-96c6-464a57c56cf0" />

