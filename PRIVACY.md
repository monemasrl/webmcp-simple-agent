# Privacy Policy — WebMCP Simple Agent

**Effective date:** 10 September 2026
**Last updated:** 10 September 2026

WebMCP Simple Agent ("the extension") is a browser extension that adds an AI
chat which operates the current web page through the
[WebMCP](https://webmachinelearning.github.io/webmcp/) tools that page exposes.
This policy explains what data the extension handles and where it goes.

**Summary:** the extension does not collect, sell, or transmit your data to us.
Your API key and conversations stay in your browser. The only network requests
the extension makes are the ones you trigger — sending your messages to the AI
provider you configured.

## Data the extension handles

- **API key.** The key you enter for your chosen AI provider (Anthropic, OpenAI
  or Kimi) is stored locally in your browser via `chrome.storage.local`. It is
  used only to authenticate requests to that provider. It is never sent
  anywhere else and is never transmitted to the developer.
- **Settings.** Your provider, model and interface-language preferences are
  stored locally in the same way.
- **Conversations.** Your prompts, the assistant's replies, and the display
  history are stored locally in your browser so the chat persists between
  openings. They are not transmitted to the developer.
- **Page tool data.** When you send a message, the extension reads the WebMCP
  tools the active page exposes (tool names, descriptions, and the inputs/
  outputs of tools the AI invokes on your behalf) so the model can use them.
  This information is included in the request to your chosen AI provider as
  part of the conversation.

## Where your data goes

- **Your chosen AI provider.** Your messages, conversation history, the page's
  tool definitions, and tool results are sent **directly from your browser** to
  the API of the provider you configured — Anthropic (`api.anthropic.com`),
  OpenAI (`api.openai.com`), or Kimi/Moonshot (`api.moonshot.cn`). This data is
  handled under **that provider's** privacy policy and terms. The extension does
  not proxy this traffic through any server operated by the developer.
- **Voice input (optional).** If you use the microphone button, speech
  recognition is performed by your browser's built-in Web Speech API. In Google
  Chrome this means the captured audio is processed by Google's speech-to-text
  service, under Google's privacy policy. Voice input is used only to fill the
  message box and is off unless you activate it.

## What the extension does NOT do

- It does **not** send any data to servers operated by the developer — there is
  no developer backend.
- It does **not** contain analytics, tracking, advertising, or fingerprinting.
- It does **not** sell or share your data with third parties (beyond the AI
  provider request you initiate, described above).
- It does **not** read or transmit page content on its own; it only reads the
  WebMCP tool interface a page deliberately exposes, and only when you send a
  message.

## Permissions and why they are needed

- **storage** — to save your API key and settings locally.
- **tabs** — to identify the active tab and read the WebMCP tools it exposes.
- **sidePanel** — to show the optional side-panel chat.
- **host access** to `api.anthropic.com`, `api.openai.com`, `api.moonshot.cn` —
  to call the AI provider you selected.

## Data retention and deletion

All data (API key, settings, conversations) lives only in your browser. You can
delete it at any time by clearing the extension's storage, removing the
extension, or clearing your browser data. Removing the extension deletes its
locally stored data.

## Children

The extension is not directed to children under 13 and does not knowingly
collect data from them.

## Changes to this policy

We may update this policy; material changes will be reflected by updating the
"Last updated" date above and, where appropriate, the extension listing.

## Contact

For questions about this policy, contact: **info@monema.it**
