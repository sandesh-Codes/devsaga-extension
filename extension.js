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

            console.log("DevSaga response:", data);
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
