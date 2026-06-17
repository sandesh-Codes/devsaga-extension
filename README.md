# DevSaga VS Code Extension

Automatically detects errors in your terminal and sends them to [DevSaga](https://devsaga-app.vercel.app) for AI-powered debugging — and silently builds your personal learning profile over time.

## The idea

Most devs fix bugs and move on. DevSaga remembers them.

Every error you hit in VS Code gets captured, debugged with AI, and saved to your account. Over time DevSaga analyzes your bug history, finds your weak concepts, suggests free resources, and generates tests curated to exactly what you struggle with.

The extension is the data collection layer. Your terminal is where you actually work — so that's where DevSaga lives too.

## How it works

1. Extension watches your terminal automatically
2. When a command fails, it captures the error output
3. A notification appears: "Error detected. Debug with DevSaga?"
4. Click **Debug** — error is sent to DevSaga AI
5. Get instant fix and explanation
6. Session is saved to your account silently
7. Over time, your [IRT dashboard](https://devsaga-app.vercel.app) shows your weak spots, suggested resources, and personalized tests

## Setup

### 1. Install the extension
Clone this repo and open it in VS Code, then press `F5` to run the extension.

### 2. Get your API token
Go to [devsaga-app.vercel.app/settings](https://devsaga-app.vercel.app/settings), generate your token and copy it.

### 3. Set your token in VS Code
Press `Ctrl+Shift+P` → type **DevSaga: Set Token** → paste your token.

You're ready. Every terminal error will now be debugged and tracked automatically.

## Requirements

- VS Code 1.80+
- Node.js
- A DevSaga account at [devsaga-app.vercel.app](https://devsaga-app.vercel.app)

## Tech Stack

- JavaScript
- VS Code Extension API
- DevSaga REST API

## Related

- [DevSaga Web App](https://devsaga-app.vercel.app)
- [DevSaga GitHub](https://github.com/sandesh-Codes/devsaga)

## Author

Sandesh Kumar — [@sandesh-Codes](https://github.com/sandesh-Codes)
