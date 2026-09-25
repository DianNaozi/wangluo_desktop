import { app, BrowserWindow, ipcMain, net, protocol, shell } from 'electron'
import { access } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { ImportManager } from './import/import-manager'

let importManager: ImportManager
protocol.registerSchemesAsPrivileged([{ scheme: 'gallery-thumb', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }])

function createWindow(): void {
  const window = new BrowserWindow({
    width: 1440, height: 920, minWidth: 1080, minHeight: 720,
    title: '幻视图库', backgroundColor: '#09090b', autoHideMenuBar: true,
    webPreferences: { preload: join(__dirname, '../preload/index.js'), contextIsolation: true, nodeIntegration: false, sandbox: true }
  })
  window.webContents.setWindowOpenHandler(({ url }) => { void shell.openExternal(url); return { action: 'deny' } })
  if (process.env['ELECTRON_RENDERER_URL']) void window.loadURL(process.env['ELECTRON_RENDERER_URL'])
  else void window.loadFile(join(__dirname, '../renderer/index.html'))
}

app.whenReady().then(() => {
  ipcMain.handle('app:get-version', () => app.getVersion())
  const libraryRoot = join(app.getPath('userData'), 'media-library')
  importManager = new ImportManager(join(app.getPath('userData'), 'local-gallery.sqlite'), libraryRoot)
  void importManager.initialize(libraryRoot)
  protocol.handle('gallery-thumb', async (request) => {
    const hash = new URL(request.url).hostname
    if (!/^[a-f0-9]{64}$/.test(hash)) return new Response('Not found', { status: 404 })
    const thumbnailPath = join(libraryRoot, 'thumbnails', `${hash}.webp`)
    try {
      await access(thumbnailPath)
      return net.fetch(pathToFileURL(thumbnailPath).toString())
    } catch { return new Response('Not found', { status: 404 }) }
  })
  ipcMain.handle('media:import-files', (event) => importManager.importFiles(BrowserWindow.fromWebContents(event.sender) ?? BrowserWindow.getFocusedWindow()!))
  ipcMain.handle('media:import-folders', (event) => importManager.importFolders(BrowserWindow.fromWebContents(event.sender) ?? BrowserWindow.getFocusedWindow()!))
  ipcMain.handle('media:get-jobs', () => importManager.getJobs())
  ipcMain.handle('media:get-job', (_event, jobId: string) => importManager.getJob(jobId))
  ipcMain.handle('media:get-library', () => importManager.getLibrary())
  ipcMain.handle('media:get-album', (_event, albumId: string) => importManager.getAlbum(albumId))
  ipcMain.handle('media:get-trash', () => importManager.getTrash())
  ipcMain.handle('media:retry-job', (_event, jobId: string) => importManager.retry(jobId))
  ipcMain.handle('media:rebuild-previews', () => importManager.rebuildPreviews())
  ipcMain.handle('media:trash-media', (_event, mediaId: string) => importManager.trashMedia(mediaId))
  ipcMain.handle('media:trash-album', (_event, albumId: string) => importManager.trashAlbum(albumId))
  ipcMain.handle('media:restore-media', (_event, mediaId: string) => importManager.restoreMedia(mediaId))
  ipcMain.handle('media:restore-album', (_event, albumId: string) => importManager.restoreAlbum(albumId))
  ipcMain.handle('media:purge-trash', (_event, mediaId: string) => importManager.purgeTrash(mediaId))
  ipcMain.handle('media:purge-album', (_event, albumId: string) => importManager.purgeAlbum(albumId))
  ipcMain.handle('media:purge-all-trash', () => importManager.purgeAllTrash())
  createWindow()
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })
})
app.on('before-quit', () => { void importManager?.dispose() })
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
