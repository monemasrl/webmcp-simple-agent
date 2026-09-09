chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((err) => console.error('sidePanel behavior', err))

chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.kind === 'open-options') chrome.runtime.openOptionsPage()
})
