import { installRelay } from './relay-core'

installRelay(window, {
  sendMessage: (msg) => {
    chrome.runtime.sendMessage(msg).catch(() => {
      /* no listener (panel closed) — fine */
    })
  },
  onMessage: (handler) => {
    chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
      return handler(msg, sendResponse) === true
    })
  },
})
