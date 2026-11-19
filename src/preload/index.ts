import { contextBridge, ipcRenderer, webUtils } from 'electron'

contextBridge.exposeInMainWorld('facets', {
  call: (method: string, ...args: unknown[]) => ipcRenderer.invoke('facets', method, args),
  on: (channel: string, cb: (payload: unknown) => void) => {
    const fn = (_e: unknown, payload: unknown): void => cb(payload)
    ipcRenderer.on(channel, fn)
    return () => ipcRenderer.removeListener(channel, fn)
  },
  window: (cmd: string) => ipcRenderer.send('window', cmd),
  pathForFile: (f: File) => webUtils.getPathForFile(f),
  platform: process.platform
})
