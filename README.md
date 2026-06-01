# Markdown Studio

Notion-like WYSIWYG markdown editor for VS Code — rich diffs, tables, images, math, and more.

I read as much `.md` as all other programming languages combined.

Personal notes, research notes, Claude Code generated reports, random READMEs.

I find it easier to read Notion-like markdown rather than raw markdown.

That's why Markdown Studio exists.

## Contents

- [The Cool Stuff](#the-cool-stuff)
- [Loaded With Features](#loaded-with-features)
- [Known Limitations](#known-limitations)
- [Reference](#reference)
  - [Requirements](#requirements)
  - [Installation](#installation)
  - [Commands](#commands)
  - [Keyboard shortcuts](#keyboard-shortcuts)
  - [Settings](#settings)
  - [Privacy](#privacy)
  - [License](#license)
  - [Contributing](#contributing)
  - [Available platforms](#available-platforms)

## The Cool Stuff

### Rich git Diffs

You have seen rich editing. WYSIWYG for faster reading.

But have you seen rich diffing?

![diff](assets/diff.gif)

### Seamless Sync.

Open in the Default Editor.

Open in the Rich Editor.

It just works.

![seamless-sync](assets/seamless-sync.gif)

### Navigate without hassle.

Sticky headings so you can navigate long documents with ease.

Table of contents so you know where you are.

Clicky here, go there.

![navigate](assets/navigate.gif)

## Loaded With Features

### Modes

#### Default Editor

Default editor supports opening in Rich Editor mode.

Enjoy it because this will be the last time you open the vanilla view.

![default-editor-overview](assets/default-editor-overview.png)

#### Rich Editor

Rich editor allows to go back to default editor mode directly. All information is automatically and instantly synced.

![rich-editor-overview](assets/rich-editor-overview.png)

### Rich editing

#### Slash Commands

The beloved `/` works out of the box. It's like you never left your favourite editor.

![slash-command-working](assets/slash-command-working.png)

#### Checkboxes, Tables, Math, Quotes, Code Blocks, and your standard stuff.

Tables have options to:

- add row above, add row below
- add column to the left, add columns to the right
- remove rows, remove columns
- drop the entire table

You can write math using $\KaTeX$ in both inline and block modes.

![checkboxes-table-inline-math](assets/checkboxes-table-inline-math.png)

![math-block](assets/math-block.png)

#### Mermaid Diagrams

A code fence labelled `mermaid` renders as a live diagram inline — edit the source, the preview updates.

![mermaid](assets/mermaid.gif)

#### YouTube & GitHub Embeds

Paste a YouTube or GitHub URL and get a rich card; the source stays a bare URL so the file remains portable.

![embedding](assets/embedding.gif)

## Known Limitations

- Conversion from markdown to rich text and back is not a 1:1 map — the file is normalized on save. You can tune normalization via the settings icon in rich editor mode, or under `markdownStudio.*` in VS Code settings.
- A handful of CommonMark edge cases (e.g. bold/italic directly adjacent to a code span) need a tiny separator to round-trip cleanly. The editor handles this automatically. See [docs/LEARNING.md](docs/LEARNING.md) for the gory details.

---

## Reference

### Requirements

- VS Code 1.80.0 or newer
- Activates on `.md` files — no login, no other dependencies

### Installation

Hit the Install button on the marketplace page. No login, setup or permissions required. It works out of the box.

### Commands

Every action is in the command palette under the `Markdown Studio:` prefix.

| Command palette title     | Shortcut                                      | What it does                                                                                                                                                      |
| ------------------------- | --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Toggle Rich/Source Editor | Cmd/Ctrl+Shift+M (on `.md` files)             | Swap the active `.md` between the rich editor and VS Code's default text editor.                                                                                  |
| Find in Document          | Cmd/Ctrl+F (inside the rich editor)           | Open the in-editor search bar for the current rich-editor pane.                                                                                                   |
| Open Rich Diff            | Right-click an SCM entry, or the diff toolbar | Open a side-by-side or rendered markdown diff of the selected file vs HEAD (or any two URIs).                                                                     |
| Factory Reset Settings    | —                                             | Wipe all Markdown Studio settings back to defaults and re-show the welcome modal on the next file open. Confirms before applying.                                 |

### Keyboard shortcuts

| Shortcut             | Action                                                    |
| -------------------- | --------------------------------------------------------- |
| Cmd/Ctrl+Shift+M     | Toggle rich / source editor                               |
| Cmd/Ctrl+F           | Find in document (rich editor)                            |
| Cmd/Ctrl+B           | Bold                                                      |
| Cmd/Ctrl+I           | Italic                                                    |
| Cmd/Ctrl+Shift+X     | Strikethrough                                             |
| Cmd/Ctrl+E           | Inline code                                               |
| Cmd/Ctrl+Alt+1..6    | Heading level 1–6                                         |
| Cmd/Ctrl+Alt+0       | Paragraph                                                 |
| Cmd/Ctrl+/           | Bubble menu on selection (expands to surrounding word)    |
| /                    | Slash command menu (at the start of a line)               |

Standard markdown input rules also work — type `# `, `- `, `1. `, ` ``` `, `> `, `[ ]` at the start of a line and the editor turns them into the matching block as you type.

### Settings

All settings live under `markdownStudio.*` in VS Code's native settings store. Three ways to reach them:

- Settings UI — search for "Markdown Studio"
- `.vscode/settings.json` (any scope)
- Gear icon inside the rich editor (writes to User scope)

| Setting                              | Default         | What it controls                                                            |
| ------------------------------------ | --------------- | --------------------------------------------------------------------------- |
| `markdownStudio.autoSave`            | `true`          | Silent save on first open to persist the round-trip normalization           |
| `markdownStudio.bullet`              | `-`             | Unordered-list bullet (`-` / `*` / `+`)                                     |
| `markdownStudio.emphasis`            | `_`             | Italic marker (`_` or `*`)                                                  |
| `markdownStudio.strong`              | `**`            | Bold marker (`**` or `__`)                                                  |
| `markdownStudio.rule`                | `-`             | Horizontal-rule character (`-` / `*` / `_`)                                 |
| `markdownStudio.listItemIndent`      | `one`           | List continuation indent (`one` / `tab` / `mixed`)                          |
| `markdownStudio.bubbleMenuShortcut`  | `Mod+/`         | Keybinding for the selection bubble menu                                    |
| `markdownStudio.defaultCodeBlockLang`| `""`            | Default language for unlabelled code blocks                                 |
| `markdownStudio.diffMode`            | `rendered`      | Default rich-diff view (`source` / `rendered`)                              |
| `markdownStudio.diffLayout`          | `side-by-side`  | Layout for the source diff (`unified` / `side-by-side`)                     |
| `markdownStudio.compactLists`        | `true`          | Drop blank lines between consecutive list items                             |
| `markdownStudio.unescapeSpecialChars`| `true`          | Strip redundant `\~`, `\*`, `\_`, `\[` escapes                              |
| `markdownStudio.renumberOrderedLists`| `true`          | Renumber ordered lists to `1.`, `2.`, `3.`, …                               |
| `markdownStudio.shellscriptToBash`   | `true`          | Rewrite `shellscript` code fences to `bash`                                 |
| `markdownStudio.fixTableHeaders`     | `true`          | Rebuild empty table headers after conversion                                |
| `markdownStudio.dedupImageAltText`   | `true`          | Collapse `![alt](x)\nalt` → `![alt](x)`                                     |

### Privacy

I do not collect telemetry, analytics, or usage data.

I am too lazy to implement that.

Everything runs locally in your VS Code instance.

### License

[MIT](LICENSE) — do whatever, just don't blame me.

### Contributing

Bug reports, feature requests and PRs are welcome at the [issue tracker](https://github.com/chaudhary1337/markdown-studio/issues). I am actively using it myself, so expect frequent updates.

### Available platforms

- VS Code Marketplace — <https://marketplace.visualstudio.com/items?itemName=tanishq-chaudhary.its-markdown-studio>
- Open VSX Registry — <https://open-vsx.org/extension/tanishq-chaudhary/its-markdown-studio>
