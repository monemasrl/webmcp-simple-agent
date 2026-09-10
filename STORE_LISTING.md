# Store Listing — WebMCP Simple Agent

Copy for the Chrome Web Store listing.

## Name

WebMCP Simple Agent

## Short description (≤132 chars)

In-page AI chat that operates the current site through its WebMCP tools. Bring your own key: Anthropic, OpenAI or Kimi.

## Long description

WebMCP Simple Agent adds an AI chat assistant to any website that exposes WebMCP tools. When a page offers tools, a floating chat button appears in the corner. Ask in plain language, and the assistant uses the page's own tools to get things done for you — looking up data, filling forms, and triggering the actions the site makes available.

It works on standard Chrome. A content script polyfills the WebMCP interface, so no experimental browser flag is required.

**How it works**

The assistant only acts through the tools a page deliberately exposes. It reads those tool definitions, decides which ones to call based on your request, runs them, and reasons over the results to answer you. Nothing happens outside the capabilities the site itself provides.

**Two ways to use it**

- In-page widget: a support-chat–style panel that opens from a floating button, appearing only when the current page exposes tools.
- Side panel: the same assistant available from the extension icon, for a persistent side-by-side view.

**Bring your own API key**

You connect your own account from one of the supported providers and choose the model you prefer:

- Anthropic (Claude)
- OpenAI
- Kimi (Moonshot)

Your key is stored locally in your browser and is used only to authenticate requests to the provider you selected. Requests go directly from your browser to that provider; there is no intermediary server.

**Broad WebMCP support**

- Imperative tools registered in JavaScript via document.modelContext.registerTool().
- Declarative tools declared in HTML as form elements with tool attributes, which the assistant can fill and submit on your behalf.

**Productive chat interface**

- Slash commands for quick control: /config, /model, /tools, /debug, /language, /clear, and /help.
- A live status indicator that shows each step of a request — sending, receiving, calling a tool, and processing — followed by the total processing time.
- Markdown-formatted answers.
- Voice input using the browser's built-in speech recognition, in the interface language you selected.
- Bilingual interface: English and Italian.

**Built-in debugging**

Enable debug mode to open a separate window that streams the raw requests and responses exchanged with the model and with each tool, formatted and color-coded, so you can see exactly what the assistant is doing.

**Privacy**

The extension has no backend of its own. Your API key, settings, and conversations stay in your browser. The only network requests are the ones you trigger, sent directly to the AI provider you configured. There is no analytics, tracking, or advertising. See the privacy policy for details.

**Requirements**

An API key from one of the supported providers is required. No account with us and no sign-up is needed.

## Privacy policy URL

https://monemasrl.github.io/webmcp-simple-agent/PRIVACY

## Permission justifications

- storage — save the API key and settings locally.
- tabs — identify the active tab and read the WebMCP tools it exposes.
- sidePanel — show the optional side-panel chat.
- host access (api.anthropic.com, api.openai.com, api.moonshot.cn) — call the AI provider you selected.
