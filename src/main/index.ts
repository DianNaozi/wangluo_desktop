import { app, BrowserWindow, dialog, ipcMain, net, protocol, shell } from 'electron'
import { access, mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { ImportManager } from './import/import-manager'

let importManager: ImportManager
let resourceRoot = ''
let deleteSourcesAfterImport = false

type ResourceDirectory = { path: string; usesDefault: boolean }
type ImportBehaviorSettings = { deleteSourcesAfterImport: boolean }
type StoredSettings = { resourceDirectory?: string; deleteSourcesAfterImport?: boolean }

function defaultResourceRoot(): string { return join(app.getPath('userData'), 'media-library') }
function settingsPath(): string { return join(app.getPath('userData'), 'gallery-settings.json') }

async function loadStoredSettings(): Promise<StoredSettings> {
  try { return JSON.parse(await readFile(settingsPath(), 'utf8')) as StoredSettings }
  catch { return {} }
}
function resourceDirectoryFrom(settings: StoredSettings): ResourceDirectory {
  if (settings.resourceDirectory && isAbsolute(settings.resourceDirectory)) return { path: resolve(settings.resourceDirectory), usesDefault: false }
  return { path: defaultResourceRoot(), usesDefault: true }
}
function pathsOverlap(first: string, second: string): boolean {
  const contains = (parent: string, candidate: string): boolean => {
    const relation = relative(resolve(parent), resolve(candidate))
    return relation === '' || (!relation.startsWith('..') && !isAbsolute(relation))
  }
  return contains(first, second) || contains(second, first)
}
async function saveStoredSettings(update: Partial<StoredSettings>): Promise<void> {
  await mkdir(app.getPath('userData'), { recursive: true })
  const temporaryPath = `${settingsPath()}.tmp`
  const settings = { ...await loadStoredSettings(), ...update }
  await writeFile(temporaryPath, JSON.stringify(settings, null, 2), 'utf8')
  await rename(temporaryPath, settingsPath())
}

async function startImportManager(root: string, deleteSources: boolean): Promise<void> {
  await mkdir(root, { recursive: true })
  // The database, original files, thumbnails, temporary files and trash all live below this root.
  importManager = new ImportManager(join(root, 'local-gallery.sqlite'), root, deleteSources)
  await importManager.initialize(root)
}
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

app.whenReady().then(async () => {
  ipcMain.handle('app:get-version', () => app.getVersion())
  const settings = await loadStoredSettings()
  const directory = resourceDirectoryFrom(settings)
  resourceRoot = directory.path
  deleteSourcesAfterImport = settings.deleteSourcesAfterImport === true
  await startImportManager(resourceRoot, deleteSourcesAfterImport)
  protocol.handle('gallery-thumb', async (request) => {
    const hash = new URL(request.url).hostname
    if (!/^[a-f0-9]{64}$/.test(hash)) return new Response('Not found', { status: 404 })
    const thumbnailPath = join(resourceRoot, 'thumbnails', `${hash}.webp`)
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
  ipcMain.handle('media:export-orphan', (event, orphanId: string) => importManager.exportOrphan(BrowserWindow.fromWebContents(event.sender) ?? BrowserWindow.getFocusedWindow()!, orphanId))
  ipcMain.handle('media:purge-orphan', (_event, orphanId: string) => importManager.purgeOrphan(orphanId))
  ipcMain.handle('settings:get-resource-directory', async (): Promise<ResourceDirectory> => {
    return resourceDirectoryFrom(await loadStoredSettings())
  })
  ipcMain.handle('settings:get-import-behavior', async (): Promise<ImportBehaviorSettings> => ({ deleteSourcesAfterImport: (await loadStoredSettings()).deleteSourcesAfterImport === true }))
  ipcMain.handle('settings:set-delete-sources-after-import', async (_event, enabled: boolean): Promise<ImportBehaviorSettings> => {
    if (typeof enabled !== 'boolean') throw new Error('设置值无效')
    await importManager.setDeleteSourcesAfterImport(enabled)
    deleteSourcesAfterImport = enabled
    await saveStoredSettings({ deleteSourcesAfterImport })
    return { deleteSourcesAfterImport }
  })
  ipcMain.handle('settings:pick-resource-directory', async (event): Promise<string | null> => {
    const result = await dialog.showOpenDialog(BrowserWindow.fromWebContents(event.sender) ?? BrowserWindow.getFocusedWindow()!, { title: '选择资源存储目录', properties: ['openDirectory', 'createDirectory'] })
    return result.canceled ? null : result.filePaths[0] ?? null
  })
  ipcMain.handle('settings:set-resource-directory', async (_event, candidate: string): Promise<ResourceDirectory> => {
    if (typeof candidate !== 'string' || !candidate.trim() || !isAbsolute(candidate.trim())) throw new Error('请输入有效的绝对路径')
    const nextRoot = resolve(candidate.trim())
    if (nextRoot === resourceRoot) return { path: resourceRoot, usesDefault: false }
    if (pathsOverlap(resourceRoot, nextRoot)) throw new Error('新目录不能与当前资源目录重叠')
    const eligibility = await importManager.getStorageEligibility()
    if (!eligibility.canChangeResourceDirectory) throw new Error(eligibility.reason ?? '当前图库不是空图库，不能切换资源目录')
    let targetEntries: string[]
    try {
      targetEntries = await readdir(nextRoot)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      targetEntries = []
    }
    if (targetEntries.length) throw new Error('新资源目录必须为空')
    await mkdir(nextRoot, { recursive: true })
    await importManager.dispose()
    resourceRoot = nextRoot
    await startImportManager(resourceRoot, deleteSourcesAfterImport)
    await saveStoredSettings({ resourceDirectory: resourceRoot })
    return { path: resourceRoot, usesDefault: false }
  })
  createWindow()
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })
})
app.on('before-quit', () => { void importManager?.dispose() })
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
