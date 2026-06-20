const vscode = require("vscode");

/**
 * @param {string} raw
 */

function cleanOutput(raw) {
  return raw
    .replace(/\x1b\[[0-9;]*m/g, "") // ANSI color codes
    .replace(/\][0-9]+;[^\x07]*\x07/g, "") // OSC sequences with BEL terminator
    .replace(/\][0-9]+;[^\\]*\\/g, "") // OSC sequences with ST terminator
    .replace(/\]633;[A-Z][^\x07]*(\x07)?/g, "") // VS Code shell integration specifically
    .split("\n")
    .filter(
      (line) =>
        !line.includes("powershell.exe") && !line.includes("WindowsPowerShell"),
    )
    .join("\n")
    .trim();
}

// ---- Live error detection (for long-running processes like dev servers) ----

// Broad, framework-agnostic patterns. Order doesn't matter; first match wins.
const ERROR_PATTERNS = [
  /uncaught\s+(?:exception|error)/i,
  /unhandled\s+(?:promise\s+)?rejection/i,
  /\bfatal\b/i,
  /\bpanic:/i,
  /segmentation\s+fault/i,
  /\btraceback\s*\(most recent call last\)/i,
  /\b[A-Za-z]*Error\b\s*[:[]/, // SyntaxError:, TypeError:, ReferenceError[Object], etc.
  /\bException\b\s*[:[]/,
  /\bcannot find module\b/i,
  /\bmodule not found\b/i,
  /\bENOENT\b/,
  /\bEADDRINUSE\b/,
  /\b5\d{2}\b.*\bin\s+\d+m?s\b/i, // e.g. "500 in 42ms" (Next.js style)
  /compiled with \d+ error/i,
  /build failed/i,
  /failed to compile/i,
];

const CONTEXT_CHARS_BEFORE = 200;
const CONTEXT_CHARS_AFTER = 400;
const DEBOUNCE_MS = 400;
const MAX_LIVE_BUFFER = 8000; // cap so long-running servers don't grow this unbounded

/**
 * Per-terminal-execution live detection state.
 * Keyed by a Symbol/object per execution so concurrent terminals don't interfere.
 */
function createLiveWatcher({ onError }) {
  let buffer = "";
  let scannedUpTo = 0; // index into buffer; everything before this has already been checked
  let debounceTimer = null;
  let lastFiredSignature = null;

  function signatureOf(text) {
    // Cheap, stable signature: collapse whitespace, take first ~150 chars.
    return text.replace(/\s+/g, " ").trim().slice(0, 150);
  }

  function scan() {
    const unscanned = buffer.slice(scannedUpTo);
    if (!unscanned) return;

    for (const pattern of ERROR_PATTERNS) {
      const match = unscanned.match(pattern);
      if (!match) continue;

      const idxInUnscanned = match.index ?? 0;
      const idx = scannedUpTo + idxInUnscanned; // absolute index in buffer

      const sigEnd = Math.min(buffer.length, idx + 120);
      const signature = signatureOf(buffer.slice(idx, sigEnd));

      // Advance the pointer past this match's signature window regardless of
      // whether we fire, so this exact occurrence is never re-scanned.
      scannedUpTo = sigEnd;

      if (signature === lastFiredSignature) {
        // Same error text as last time we fired. Skip, but keep scanning
        // forward in case something NEW follows later in the buffer.
        return scan();
      }

      const start = Math.max(0, idx - CONTEXT_CHARS_BEFORE);
      const end = Math.min(buffer.length, idx + CONTEXT_CHARS_AFTER);
      const snippet = buffer.slice(start, end);

      lastFiredSignature = signature;
      onError(snippet);
      return; // one error per scan pass; rest of buffer waits for next feed
    }

    // Nothing matched in the unscanned tail. Leave a small overlap (in case
    // a pattern straddles the boundary of the next chunk) and mark the rest
    // as scanned so we don't keep re-checking the same clean text forever.
    const overlap = 100;
    scannedUpTo = Math.max(scannedUpTo, buffer.length - overlap);
  }

  function feed(chunk) {
    buffer += chunk;
    if (buffer.length > MAX_LIVE_BUFFER) {
      const trimAmount = buffer.length - MAX_LIVE_BUFFER;
      buffer = buffer.slice(trimAmount);
      scannedUpTo = Math.max(0, scannedUpTo - trimAmount);
    }

    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(scan, DEBOUNCE_MS);
  }

  function reset() {
    buffer = "";
    scannedUpTo = 0;
    lastFiredSignature = null;
    if (debounceTimer) clearTimeout(debounceTimer);
  }

  function dispose() {
    if (debounceTimer) clearTimeout(debounceTimer);
  }

  return { feed, reset, dispose };
}

/**
 * @param {object} data
 * @param {vscode.ExtensionContext} context
 */

function showDebugPanel(data, context) {
    const panel = vscode.window.createWebviewPanel(
        'devsagaDebug',
        'DevSaga - Debug Result',
        vscode.ViewColumn.Beside,
        {enableScripts: false}
    );

    const steps = data.steps.map(s => `<li>${s}</li>`).join('');
    const mistakes = data.mistakes.map(m => `<li>${m}</li>`).join('');
    const fixedCode = data.fixedCode
        ? `<div class="section">
            <h2>Fixed Code</h2>
            <pre><code>${data.fixedCode}</code></pre>
           </div>`
        : '';

    panel.webview.html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<style>
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    padding: 24px;
    color: var(--vscode-foreground);
    background: var(--vscode-editor-background);
    line-height: 1.6;
    max-width: 800px;
  }
  h1 {
    font-size: 18px;
    margin-bottom: 4px;
    color: var(--vscode-foreground);
  }
  .badge {
    display: inline-block;
    font-size: 11px;
    padding: 2px 8px;
    border-radius: 4px;
    background: var(--vscode-badge-background);
    color: var(--vscode-badge-foreground);
    margin-bottom: 20px;
  }
  .section {
    margin-bottom: 24px;
  }
  h2 {
    font-size: 13px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--vscode-descriptionForeground);
    margin-bottom: 8px;
  }
  p, li {
    font-size: 14px;
  }
  ul {
    padding-left: 20px;
    margin: 0;
  }
  li {
    margin-bottom: 6px;
  }
  pre {
    background: var(--vscode-textCodeBlock-background);
    padding: 12px 16px;
    border-radius: 6px;
    overflow-x: auto;
    font-size: 13px;
  }
  code {
    font-family: 'Cascadia Code', 'Fira Code', monospace;
  }
  .weak-area {
    display: inline-block;
    padding: 4px 10px;
    border-radius: 4px;
    font-size: 13px;
    background: var(--vscode-inputValidation-warningBackground);
    color: var(--vscode-foreground);
    border: 1px solid var(--vscode-inputValidation-warningBorder);
  }
  hr {
    border: none;
    border-top: 1px solid var(--vscode-panel-border);
    margin: 20px 0;
  }
</style>
</head>
<body>
  <h1>Debug Result</h1>
  <span class="badge">${data.category}</span>

  <div class="section">
    <h2>Root Cause</h2>
    <p>${data.rootCause}</p>
  </div>

  <div class="section">
    <h2>Explanation</h2>
    <p>${data.explanation}</p>
  </div>

  <div class="section">
    <h2>How to Fix</h2>
    <ul>${steps}</ul>
  </div>

  ${fixedCode}

  <div class="section">
    <h2>Common Mistakes</h2>
    <ul>${mistakes}</ul>
  </div>

  <hr>

  <div class="section">
    <h2>Weak Area Detected</h2>
    <span class="weak-area">⚠️ ${data.weakArea}</span>
  </div>
</body>
</html>`;
}

/**
 * Shared flow: given raw error text, prompt the user and run the debug pipeline.
 * Used by both the exit-code path and the live-detection path.
 * @param {string} rawErrorText
 * @param {vscode.ExtensionContext} context
 */
function promptAndDebug(rawErrorText, context) {
  const cleaned = cleanOutput(rawErrorText);
  if (!cleaned) return;

  vscode.window
    .showInformationMessage(
      "DevSaga: Error detected. Debug with DevSaga?",
      "Debug",
      "Dismiss",
    )
    .then(async (selection) => {
      if (selection !== "Debug") return;

      const token = await context.secrets.get("devsaga.apiToken");

      if (!token) {
        vscode.window.showErrorMessage(
          'DevSaga: No token found. Run "DevSaga: Set Token" command first.',
        );
        return;
      }

      try {
        vscode.window.showInformationMessage("DevSaga: Analyzing error...");

        const response = await fetch(
          "https://devsaga-app.vercel.app/api/extension/debug",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({
              error: cleaned,
              code: "",
            }),
          },
        );

        const data = await response.json();

        if (!response.ok) {
          vscode.window.showErrorMessage(
            `DevSaga: ${data.error || "Something went wrong"}`,
          );
          return;
        }

        showDebugPanel(data, context);

        vscode.window.showInformationMessage(
          "DevSaga: Analysis complete! Check the debug console.",
        );
      } catch (error) {
        vscode.window.showErrorMessage(
          "DevSaga: Failed to connect to server.",
        );
        console.error(error);
      }
    });
}

/**
 * @param {vscode.ExtensionContext} context
 */

function activate(context) {
  console.log("DevSaga extension is now active!");

  const setTokenCommand = vscode.commands.registerCommand(
    "devsaga.setToken",
    async () => {
      const token = await vscode.window.showInputBox({
        prompt: "Paste your DevSaga API token",
        placeHolder: "Get your token from devsaga-app.vercel.app/settings",
        ignoreFocusOut: true,
        password: true,
      });

      if (!token) return;

      await context.secrets.store("devsaga.apiToken", token);
      vscode.window.showInformationMessage("DevSaga: Token saved successfully");
    },
  );

  let outputBuffer = "";

  // Live watchers keyed per terminal, so multiple open terminals (e.g. one
  // running `npm run dev`, another idle) don't share / clobber state.
  const liveWatchers = new Map(); // terminal -> watcher

  function getLiveWatcher(terminal) {
    let watcher = liveWatchers.get(terminal);
    if (!watcher) {
      watcher = createLiveWatcher({
        onError: (snippet) => promptAndDebug(snippet, context),
      });
      liveWatchers.set(terminal, watcher);
    }
    return watcher;
  }

  const startListener = vscode.window.onDidStartTerminalShellExecution(
    (event) => {
      outputBuffer = ""; // reset for each command (used by exit-code path)

      const watcher = getLiveWatcher(event.terminal);
      watcher.reset(); // fresh command, fresh dedup state

      (async () => {
        for await (const chunk of event.execution.read()) {
          outputBuffer += chunk;
          watcher.feed(chunk);
        }
      })();
    },
  );

  const endListener = vscode.window.onDidEndTerminalShellExecution((event) => {
    const exitCode = event.exitCode;
    if (exitCode === undefined || exitCode === 0) return;

    promptAndDebug(outputBuffer, context);
  });

  const closeListener = vscode.window.onDidCloseTerminal((terminal) => {
    const watcher = liveWatchers.get(terminal);
    if (watcher) {
      watcher.dispose();
      liveWatchers.delete(terminal);
    }
  });

  context.subscriptions.push(
    setTokenCommand,
    startListener,
    endListener,
    closeListener,
  );
}

// This method is called when your extension is deactivated
function deactivate() {}

module.exports = {
  activate,
  deactivate,
};