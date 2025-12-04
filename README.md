# Git Context Menu

A lightweight VS Code extension that adds a **GoLand-like _Git_ submenu** to the File Explorer context menu.

![Git context menu Add action demo](images/action-add-file.gif)

## Features

Right-click any file in the Explorer to access:

### Git ▸ Commit…

Opens the VS Code Git commit input.

### Git ▸ Add

Stages the selected file(s).
Supports multi-select with **Ctrl + Click**.

### Git ▸ Add All

Stages all changes in the repository.

### Git ▸ Show Diff

Opens the file diff view.

### Git ▸ Rollback…

Discards local modifications for the selected file(s).

### Git ▸ Stash Changes…

Prompts for an optional stash message and runs `git stash push`.
Press **Cancel** (or **Esc**) to abort.

### Git ▸ New Branch…

Opens the “Create Branch” dialog.

### Git ▸ Push… / Pull…

Runs the standard push/pull operations.

All entries use VS Code codicons for a clean, JetBrains-style look.

## Source Control ▸ Stashes

In the Source Control panel, the **Stashes** view lists your stashes and lets you Apply, Pop, Drop, create a Branch, or Copy the message via inline actions/context menu (matching the behavior shown in the screenshot).
Click a stash to expand its files, and click a file to open a diff between the stash and its base.

## Requirements

- VS Code **1.85.0+**
- Git installed and available in PATH
- Built-in Git extension enabled
- An open folder that is a valid Git repository

## Changelog

See [CHANGELOG.md](CHANGELOG.md).
