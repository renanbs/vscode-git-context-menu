const vscode = require('vscode');
const cp = require('child_process');
const path = require('path');
const util = require('util');

const execFile = util.promisify(cp.execFile);

function wrap(commandId) {
  return async (...args) => {
    try {
      await vscode.commands.executeCommand(commandId, ...args);
    } catch (err) {
      vscode.window.showErrorMessage(
        `Failed to execute '${commandId}': ${err?.message ?? String(err)}`
      );
    }
  };
}

async function runGit(args, cwd) {
  const gitCmd = 'git';
  const { stdout, stderr } = await execFile(gitCmd, args, { cwd });
  return { stdout, stderr };
}

async function getRepoRoot(fileUri) {
  const folder = vscode.workspace.getWorkspaceFolder(fileUri);
  const cwd = folder ? folder.uri.fsPath : path.dirname(fileUri.fsPath);
  const { stdout } = await runGit(['rev-parse', '--show-toplevel'], cwd);
  return stdout.trim();
}

function normalizeToUris(targets) {
  const uris = [];
  for (const t of targets) {
    if (!t) continue;
    if (t instanceof vscode.Uri) {
      uris.push(t);
    } else if (t.resourceUri && t.resourceUri instanceof vscode.Uri) {
      uris.push(t.resourceUri);
    } else if (t.original && t.original instanceof vscode.Uri) {
      uris.push(t.original);
    }
  }
  return uris;
}

function resolveBaseUri(resource, allResources) {
  let targets = [];

  if (Array.isArray(allResources) && allResources.length > 0) {
    targets = allResources;
  } else if (Array.isArray(resource)) {
    targets = resource;
  } else if (resource) {
    targets = [resource];
  }

  const uris = normalizeToUris(targets);

  if (uris.length > 0) {
    return uris[0];
  }

  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (workspaceFolders && workspaceFolders.length > 0) {
    return workspaceFolders[0].uri;
  }

  return undefined;
}

async function listStashes(repoRoot) {
  const { stdout } = await runGit(
    ['stash', 'list', '--pretty=format:%gd::%gs'],
    repoRoot
  );

  return stdout
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line) => {
      const [ref, message] = line.split('::');
      return {
        ref: ref ?? '',
        message: message ?? ''
      };
    });
}

async function listStashFiles(repoRoot, ref) {
  const { stdout } = await runGit(
    ['show', '--name-status', '--pretty=format:', ref],
    repoRoot
  );

  return stdout
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line) => {
      const [status, ...rest] = line.split('\t');
      const filePath = rest.join('\t');
      return { status: status ?? '', path: filePath ?? '' };
    })
    .filter((f) => f.path);
}

// Stage each selected resource individually using the git CLI (supports multi-select with Ctrl+Click)
async function addSelected(resource, allResources) {
  try {
    let targets = [];

    if (Array.isArray(allResources) && allResources.length > 0) {
      targets = allResources;
    } else if (Array.isArray(resource)) {
      targets = resource;
    } else if (resource) {
      targets = [resource];
    }

    const uris = normalizeToUris(targets);

    if (uris.length === 0) {
      // Fallback: behave like Add All
      await vscode.commands.executeCommand('git.stageAll');
      return;
    }

    const repoRoot = await getRepoRoot(uris[0]);

    for (const uri of uris) {
      const relPath = path.relative(repoRoot, uri.fsPath);
      try {
        await runGit(['add', relPath], repoRoot);
      } catch (err) {
        vscode.window.showErrorMessage(
          `git add failed for ${relPath}: ${err?.message ?? String(err)}`
        );
      }
    }

    vscode.window.setStatusBarMessage(`Git: Added ${uris.length} file(s)`, 3000);
  } catch (err) {
    vscode.window.showErrorMessage(
      `Failed to add selected files: ${err?.message ?? String(err)}`
    );
  }
}

// Rollback selected files using git restore (or checkout as fallback)
async function rollbackSelected(resource, allResources) {
  try {
    let targets = [];

    if (Array.isArray(allResources) && allResources.length > 0) {
      targets = allResources;
    } else if (Array.isArray(resource)) {
      targets = resource;
    } else if (resource) {
      targets = [resource];
    }

    const uris = normalizeToUris(targets);

    if (uris.length === 0) {
      return;
    }

    const repoRoot = await getRepoRoot(uris[0]);

    for (const uri of uris) {
      const relPath = path.relative(repoRoot, uri.fsPath);
      try {
        // Prefer git restore (modern)
        await runGit(['restore', '--', relPath], repoRoot);
      } catch (errRestore) {
        try {
          // Fallback to older syntax
          await runGit(['checkout', '--', relPath], repoRoot);
        } catch (errCheckout) {
          vscode.window.showErrorMessage(
            `git restore/checkout failed for ${relPath}: ${errCheckout?.message ?? String(errCheckout)}`
          );
        }
      }
    }

    vscode.window.setStatusBarMessage(`Git: Rolled back ${uris.length} file(s)`, 3000);
  } catch (err) {
    vscode.window.showErrorMessage(
      `Failed to rollback selected files: ${err?.message ?? String(err)}`
    );
  }
}

async function newBranch() {
  try {
    await vscode.commands.executeCommand('git.branch');
  } catch (err) {
    vscode.window.showErrorMessage(
      `Failed to create branch: ${err?.message ?? String(err)}`
    );
  }
}

// Prompt for an optional stash message and run git stash push
async function stashChanges(resource, allResources) {
  try {
    const baseUri = resolveBaseUri(resource, allResources);

    if (!baseUri) {
      vscode.window.showErrorMessage('Open a folder to use Stash Changes.');
      return;
    }

    const repoRoot = await getRepoRoot(baseUri);

    const message = await vscode.window.showInputBox({
      title: 'Stash Changes',
      prompt: 'Enter a stash message (optional)',
      placeHolder: 'WIP: refactor authentication flow',
      ignoreFocusOut: true
    });

    if (message === undefined) {
      vscode.window.setStatusBarMessage('Git: Stash cancelled', 2000);
      return;
    }

    const args = ['stash', 'push'];
    const trimmed = message.trim();
    if (trimmed) {
      args.push('-m', trimmed);
    }

    await runGit(args, repoRoot);

    const label = trimmed ? ` "${trimmed}"` : '';
    vscode.window.showInformationMessage(`Git: Stash created${label}`);
  } catch (err) {
    vscode.window.showErrorMessage(
      `Failed to create stash: ${err?.message ?? String(err)}`
    );
  }
}

class StashTreeDataProvider {
  constructor() {
    this._onDidChangeTreeData = new vscode.EventEmitter();
    this.onDidChangeTreeData = this._onDidChangeTreeData.event;
    this.items = [];
    this.fileCache = new Map();
    this.repoRoot = undefined;
  }

  async refresh(resource, allResources) {
    try {
      const baseUri = resolveBaseUri(resource, allResources);
      if (!baseUri) {
        this.items = [];
        this.fileCache.clear();
        this._onDidChangeTreeData.fire();
        return;
      }

      this.repoRoot = await getRepoRoot(baseUri);
      const stashes = await listStashes(this.repoRoot);
      this.fileCache.clear();
      this.items = stashes.map((stash) =>
        this.createStashItem(stash.ref, stash.message)
      );
      this._onDidChangeTreeData.fire();
    } catch (err) {
      vscode.window.showErrorMessage(
        `Failed to load stashes: ${err?.message ?? String(err)}`
      );
    }
  }

  createStashItem(ref, message) {
    const item = new vscode.TreeItem(
      ref,
      vscode.TreeItemCollapsibleState.Collapsed
    );
    item.description = message || '(no message)';
    item.tooltip = `${ref} — ${message || '(no message)'}`;
    item.contextValue = 'gitContextMenu.stashItem';
    item.stashRef = ref;
    item.stashMessage = message;
    return item;
  }

  createFileItem(stashRef, file) {
    const label = file.path;
    const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.None);
    item.description = file.status;
    item.tooltip = `${stashRef} — ${file.status} ${file.path}`;
    item.contextValue = 'gitContextMenu.stashFile';
    item.stashRef = stashRef;
    item.filePath = file.path;
    item.command = {
      command: 'gitContextMenu.stashOpenDiff',
      title: 'Open Stash Diff',
      arguments: [item]
    };
    return item;
  }

  getTreeItem(element) {
    return element;
  }

  async getChildren(element) {
    if (!element) {
      return this.items;
    }

    if (element.contextValue === 'gitContextMenu.stashItem') {
      if (!this.repoRoot) {
        return [];
      }
      const cached = this.fileCache.get(element.stashRef);
      if (cached) {
        return cached;
      }
      const files = await listStashFiles(this.repoRoot, element.stashRef);
      const fileItems = files.map((file) =>
        this.createFileItem(element.stashRef, file)
      );
      this.fileCache.set(element.stashRef, fileItems);
      return fileItems;
    }

    return [];
  }
}

async function applyStash(item, provider) {
  if (!item?.stashRef || !provider?.repoRoot) return;
  await runGit(['stash', 'apply', item.stashRef], provider.repoRoot);
  vscode.window.showInformationMessage(`Git: Applied ${item.stashRef}.`);
}

async function popStash(item, provider) {
  if (!item?.stashRef || !provider?.repoRoot) return;
  await runGit(['stash', 'pop', item.stashRef], provider.repoRoot);
  vscode.window.showInformationMessage(`Git: Popped ${item.stashRef}.`);
  await provider.refresh();
}

async function dropStash(item, provider) {
  if (!item?.stashRef || !provider?.repoRoot) return;
  await runGit(['stash', 'drop', item.stashRef], provider.repoRoot);
  vscode.window.showInformationMessage(`Git: Dropped ${item.stashRef}.`);
  await provider.refresh();
}

async function branchFromStash(item, provider) {
  if (!item?.stashRef || !provider?.repoRoot) return;
  const branchName = await vscode.window.showInputBox({
    title: 'Create branch from stash',
    prompt: 'Enter new branch name',
    placeHolder: 'feature/from-stash',
    ignoreFocusOut: true
  });

  if (!branchName) {
    vscode.window.setStatusBarMessage('Git: Branch creation cancelled', 2000);
    return;
  }

  await runGit(['stash', 'branch', branchName, item.stashRef], provider.repoRoot);
  vscode.window.showInformationMessage(
    `Git: Branch '${branchName}' created from ${item.stashRef}.`
  );
  await provider.refresh();
}

async function copyStashMessage(item) {
  await vscode.env.clipboard.writeText(item?.stashMessage || '');
  vscode.window.showInformationMessage('Git: Stash message copied.');
}

function makeStashUri(ref, filePath, repoRoot) {
  const query = encodeURIComponent(
    JSON.stringify({ ref, path: filePath, repoRoot })
  );
  const pseudoPath = path.join(repoRoot, filePath);
  return vscode.Uri.parse(`git-context-stash:${pseudoPath}?${query}`);
}

async function openStashDiff(item, provider) {
  if (!item?.stashRef || !provider?.repoRoot || !item?.filePath) return;
  const left = makeStashUri(`${item.stashRef}^1`, item.filePath, provider.repoRoot);
  const right = makeStashUri(item.stashRef, item.filePath, provider.repoRoot);
  const title = `${item.filePath} • ${item.stashRef}`;
  await vscode.commands.executeCommand('vscode.diff', left, right, title, {
    preview: true
  });
}

class StashContentProvider {
  constructor() {
    this._onDidChange = new vscode.EventEmitter();
    this.onDidChange = this._onDidChange.event;
  }

  async provideTextDocumentContent(uri) {
    try {
      const payload = JSON.parse(uri.query);
      const { ref, path: filePath, repoRoot } = payload;
      if (!ref || !filePath || !repoRoot) return '';
      const { stdout } = await runGit(['show', `${ref}:${filePath}`], repoRoot);
      return stdout;
    } catch (err) {
      return '';
    }
  }
}

function activate(context) {
  const registerSimple = (command, target) => {
    const disposable = vscode.commands.registerCommand(command, wrap(target));
    context.subscriptions.push(disposable);
  };

  context.subscriptions.push(
    vscode.commands.registerCommand('gitContextMenu.addSelected', addSelected)
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('gitContextMenu.rollback', rollbackSelected)
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('gitContextMenu.newBranch', newBranch)
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('gitContextMenu.stash', stashChanges)
  );

  registerSimple('gitContextMenu.addAll', 'git.stageAll');
  registerSimple('gitContextMenu.commit', 'git.commit');
  registerSimple('gitContextMenu.push', 'git.push');
  registerSimple('gitContextMenu.pull', 'git.pull');
  registerSimple('gitContextMenu.diff', 'git.openChange');

  const stashProvider = new StashTreeDataProvider();
  context.subscriptions.push(
    vscode.window.registerTreeDataProvider('gitContextMenu.stashesView', stashProvider)
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('gitContextMenu.stashRefresh', () =>
      stashProvider.refresh()
    )
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('gitContextMenu.stashApply', (item) =>
      applyStash(item, stashProvider)
    )
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('gitContextMenu.stashPop', (item) =>
      popStash(item, stashProvider)
    )
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('gitContextMenu.stashDrop', (item) =>
      dropStash(item, stashProvider)
    )
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('gitContextMenu.stashBranch', (item) =>
      branchFromStash(item, stashProvider)
    )
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('gitContextMenu.stashCopy', (item) =>
      copyStashMessage(item)
    )
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('gitContextMenu.stashOpenDiff', (item) =>
      openStashDiff(item, stashProvider)
    )
  );

  // Initial load of stash list for the Source Control view
  stashProvider.refresh();

  const stashContentProvider = new StashContentProvider();
  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider(
      'git-context-stash',
      stashContentProvider
    )
  );
}

function deactivate() {}

module.exports = { activate, deactivate };
