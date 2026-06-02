// Capture the current contents of a window as a data-URL PNG, for the morph
// cover (B2). Reuses Electron's capturePage (same primitive the agent snapshot
// bridge uses). The data URL is handed to the overlay renderer to paint.
import type { BrowserWindow } from 'electron'

export async function captureFrame(win: BrowserWindow): Promise<string> {
  const image = await win.webContents.capturePage()
  return image.toDataURL()
}
