# Packaging & Distribution

## Build the extension

```bash
pnpm install
pnpm build        # outputs dist/ (manifest, JS bundles, HTML, icons)
```

## Create a store-uploadable zip

```bash
pnpm pack:zip     # builds, then writes webmcp-agent-<version>.zip
```

The archive has `manifest.json` at its root (required by the Chrome Web Store).

## Icons

Source: [assets/icon.svg](assets/icon.svg). Regenerate the PNGs with:

```bash
for s in 16 48 128; do rsvg-convert -w $s -h $s assets/icon.svg -o public/icons/icon$s.png; done
```

`public/` is copied verbatim into `dist/` by the build, so the icons ship automatically.

## Distribution options

| Method | How | When |
|--------|-----|------|
| **Chrome Web Store** | Upload the zip on the [Developer Dashboard](https://chrome.google.com/webstore/devconsole) ($5 one-time fee) | Public distribution |
| **Load unpacked** | `chrome://extensions` → enable *Developer mode* → *Load unpacked* → select `dist/` | Testing / personal use |
| **.crx self-hosted** | `chrome://extensions` → *Pack extension* → produces `.crx` + `.pem` key | Off-store distribution (needs an update manifest for auto-updates) |

## Store submission checklist

- [x] Icons declared in the manifest (16 / 48 / 128)
- [x] `host_permissions` cover every provider shipped (Anthropic, OpenAI, Kimi)
- [x] Version bumped (currently `1.0.0`)
- [ ] Store listing icon 128×128 + at least one screenshot 1280×800
- [ ] Privacy policy URL (declare that the API key and conversations are not
      collected; traffic goes only to the selected LLM provider)
- [ ] Permission justifications: `storage` (local key/settings), `tabs`
      (detect the active tab's tools), `sidePanel` (side panel UI),
      host permissions (LLM API calls)
