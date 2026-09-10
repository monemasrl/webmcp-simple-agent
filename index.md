# WebMCP Simple Agent

An in-page AI chat (plus a side panel) that operates the current web page through
the [WebMCP](https://webmachinelearning.github.io/webmcp/) tools it exposes —
both imperative (`document.modelContext.registerTool()`) and declarative
(`<form toolname>`). Bring your own API key: Anthropic, OpenAI or Kimi.

- **Source & downloads:** [github.com/monemasrl/webmcp-simple-agent](https://github.com/monemasrl/webmcp-simple-agent)
- **Latest release:** [v1.0.0](https://github.com/monemasrl/webmcp-simple-agent/releases/latest)
- **Privacy policy:** [PRIVACY](PRIVACY)

## Features

- In-page chat widget (FAB) that appears when a page exposes WebMCP tools
- Multi-provider, bring-your-own-key (Anthropic / OpenAI / Kimi) with model selection
- Slash commands: `/config`, `/model`, `/tools`, `/debug`, `/language`, `/clear`, `/help`
- Voice input (Web Speech API), IT/EN interface
- Live status bubble with processing time and a raw-call debug window

## Install

Download the zip from the [latest release](https://github.com/monemasrl/webmcp-simple-agent/releases/latest),
unzip, then load it via `chrome://extensions` → Developer mode → Load unpacked.
