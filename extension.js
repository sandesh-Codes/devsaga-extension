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

  const startListener = vscode.window.onDidStartTerminalShellExecution(
    (event) => {
      outputBuffer = ""; // reset for each command

      (async () => {
        for await (const chunk of event.execution.read()) {
          outputBuffer += chunk;
        }
      })();
    },
  );

  const endListener = vscode.window.onDidEndTerminalShellExecution((event) => {
    const exitCode = event.exitCode;
    if (exitCode === undefined || exitCode === 0) return;

    const cleaned = cleanOutput(outputBuffer);

    vscode.window
      .showInformationMessage(
        "DevSaga: Error detected. Debug with DevSaga?",
        "Debug",
        "Dismiss",
      )
      .then(async (selection) => {
        if (selection === "Debug") {
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
        }
      });
  });

  context.subscriptions.push(setTokenCommand, startListener, endListener);
}

// This method is called when your extension is deactivated
function deactivate() {}

module.exports = {
  activate,
  deactivate,
};
