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

  registerSimple('gitContextMenu.addAll', 'git.stageAll');
  registerSimple('gitContextMenu.commit', 'git.commit');
  registerSimple('gitContextMenu.push', 'git.push');
  registerSimple('gitContextMenu.pull', 'git.pull');
  registerSimple('gitContextMenu.diff', 'git.openChange');
}

function deactivate() {}

module.exports = { activate, deactivate };
