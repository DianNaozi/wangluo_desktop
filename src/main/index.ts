import { app, BrowserWindow, dialog, ipcMain, net, protocol, shell } from 'electron'
import { randomUUID } from 'node:crypto'
import { access, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import sharp from 'sharp'
import { ImportManager } from './import/import-manager'
import { SmartFolderCoserImportService, listOllamaModels, validateOllamaBaseUrl } from './import/smart-folder-coser-service'
import type { SmartFolderImportDecision, SmartFolderCoserSettings } from './import/smart-folder-coser'
import { createMediaResponse } from './media-response'
import { createPlaybackFullscreen } from './playback-fullscreen'
import { PlaybackTracker } from './playback-tracker'
import type { PlaybackSample } from './import/types'

const startupStartedAt = Date.now()
const playbackFullscreen = new WeakMap<BrowserWindow, ReturnType<typeof createPlaybackFullscreen>>()

let importManager: ImportManager
let smartFolderCoserService: SmartFolderCoserImportService | null = null
let playbackTracker: PlaybackTracker | null = null
let resourceRoot = ''
let deleteSourcesAfterImport = false
const COSER_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type ResourceDirectory = { path: string; usesDefault: boolean }
type ImportBehaviorSettings = { deleteSourcesAfterImport: boolean }
type StoredSettings = { resourceDirectory?: string; deleteSourcesAfterImport?: boolean; smartFolderCoserImport?: Partial<SmartFolderCoserSettings> }
const DEFAULT_SMART_COSER_SETTINGS: SmartFolderCoserSettings = { enabled: false, baseUrl: 'http://127.0.0.1:11434', model: 'qwen2.5:7b' }
let activeSmartCoserSettings = DEFAULT_SMART_COSER_SETTINGS

function smartCoserSettings(settings: StoredSettings): SmartFolderCoserSettings {
  const value = settings.smartFolderCoserImport
  return {
    enabled: value?.enabled === true,
    baseUrl: typeof value?.baseUrl === 'string' ? value.baseUrl : DEFAULT_SMART_COSER_SETTINGS.baseUrl,
    model: typeof value?.model === 'string' ? value.model : DEFAULT_SMART_COSER_SETTINGS.model
  }
}

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
function avatarPath(coserId: string): string { return join(resourceRoot, 'avatars', `${coserId}.webp`) }
function rendererAssetRoot(): string { return process.env['ELECTRON_RENDERER_URL'] ? join(app.getAppPath(), 'public') : join(__dirname, '../renderer') }
function rendererAssetPath(request: Request): string | null {
  const url = new URL(request.url)
  if (!['mediapipe', 'models'].includes(url.hostname)) return null
  const root = resolve(rendererAssetRoot(), url.hostname)
  const candidate = resolve(root, `.${decodeURIComponent(url.pathname)}`)
  const relation = relative(root, candidate)
  if (!relation || relation.startsWith('..') || isAbsolute(relation)) return null
  return candidate
}
function corsResponse(response: Response): Response {
  const headers = new Headers(response.headers)
  headers.set('Access-Control-Allow-Origin', '*')
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers })
}
type AvatarCrop = { left: number; top: number; size: number }
function normalizeAvatarCrop(value: unknown): AvatarCrop {
  const crop = value as Partial<AvatarCrop>
  const values = [crop?.left, crop?.top, crop?.size]
  if (!values.every((item) => typeof item === 'number' && Number.isFinite(item))) throw new Error('头像裁剪参数无效')
  const { left, top, size } = crop as AvatarCrop
  if (size <= 0 || size > 1 || left < 0 || left > 1 || top < 0 || top > 1) throw new Error('头像裁剪范围无效')
  return { left, top, size }
}
async function saveCoserAvatar(coserId: string, mediaId: string, cropValue: unknown): Promise<void> {
  if (!COSER_ID_PATTERN.test(coserId)) throw new Error('Coser 标识无效')
  const crop = normalizeAvatarCrop(cropValue)
  const normalized = await sharp(await importManager.getCoserAvatarSource(coserId, mediaId)).rotate().toBuffer({ resolveWithObject: true })
  const { width, height } = normalized.info
  if (!width || !height) throw new Error('无法读取所选图片')
  const size = Math.max(1, Math.floor(Math.min(width, height) * crop.size))
  const left = Math.floor(width * crop.left)
  const top = Math.floor(height * crop.top)
  if (left + size > width || top + size > height) throw new Error('头像裁剪范围无效')
  const directory = join(resourceRoot, 'avatars'); const target = avatarPath(coserId); const temporary = `${target}.${randomUUID()}.tmp`
  await mkdir(directory, { recursive: true })
  await sharp(normalized.data).extract({ left, top, width: size, height: size }).resize(320, 320, { fit: 'cover' }).webp({ quality: 90 }).toFile(temporary)
  await rename(temporary, target)
  await importManager.setCoserAvatar(coserId, Date.now())
}
async function clearCoserAvatar(coserId: string): Promise<void> {
  if (!COSER_ID_PATTERN.test(coserId)) throw new Error('Coser 标识无效')
  await importManager.getCoser(coserId)
  await rm(avatarPath(coserId), { force: true })
  await importManager.setCoserAvatar(coserId, null)
}
protocol.registerSchemesAsPrivileged([
  { scheme: 'gallery-thumb', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } },
  { scheme: 'gallery-media', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } },
  { scheme: 'gallery-coser-avatar', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } },
  { scheme: 'gallery-app-asset', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }
])

function createWindow(): void {
  const window = new BrowserWindow({
    width: 1440, height: 920, minWidth: 1080, minHeight: 720,
    title: '幻视图库', backgroundColor: '#09090b', autoHideMenuBar: true,
    webPreferences: { preload: join(__dirname, '../preload/index.js'), contextIsolation: true, nodeIntegration: false, sandbox: true }
  })
  window.webContents.setWindowOpenHandler(({ url }) => { void shell.openExternal(url); return { action: 'deny' } })
  const setPlaybackFullscreen = createPlaybackFullscreen(window)
  playbackFullscreen.set(window, setPlaybackFullscreen)
  window.once('ready-to-show', () => {
    if (process.env['ELECTRON_RENDERER_URL']) console.info(`[startup-perf] window ready to show: ${Math.round(Date.now() - startupStartedAt)} ms after main process start`)
  })
  window.webContents.on('render-process-gone', () => { void setPlaybackFullscreen(false).catch(() => {}) })
  window.webContents.on('did-start-loading', () => { void setPlaybackFullscreen(false).catch(() => {}) })
  if (process.env['ELECTRON_RENDERER_URL']) void window.loadURL(process.env['ELECTRON_RENDERER_URL'])
  else void window.loadFile(join(__dirname, '../renderer/index.html'))
}

app.whenReady().then(async () => {
  ipcMain.handle('app:get-version', () => app.getVersion())
  ipcMain.handle('playback:set-fullscreen', (event, active: unknown) => {
    if (typeof active !== 'boolean') throw new Error('全屏参数无效')
    const window = BrowserWindow.fromWebContents(event.sender)
    if (!window || event.senderFrame !== event.sender.mainFrame) throw new Error('无效的播放窗口')
    const setFullscreen = playbackFullscreen.get(window)
    if (!setFullscreen) throw new Error('播放窗口尚未就绪')
    return setFullscreen(active)
  })
  const mainFrameWindow = (event: Electron.IpcMainInvokeEvent): BrowserWindow => {
    const window = BrowserWindow.fromWebContents(event.sender)
    if (!window || event.senderFrame !== event.sender.mainFrame) throw new Error('无效的播放窗口')
    return window
  }
  ipcMain.handle('playback:get-state', () => importManager.getPlaybackState())
  ipcMain.handle('playback:get-media', (event, mediaIds: string[]) => { mainFrameWindow(event); return importManager.getPlaybackMedia(mediaIds) })
  ipcMain.handle('playback:save-state', (event, payload: unknown) => { mainFrameWindow(event); return importManager.savePlaybackState(payload) })
  ipcMain.handle('playback:begin-session', (event, sessionId: unknown) => {
    mainFrameWindow(event)
    if (typeof sessionId !== 'string' || sessionId.length > 200) throw new Error('播放会话无效')
    playbackTracker?.begin(sessionId)
  })
  ipcMain.handle('playback:sample', async (event, value: unknown) => {
    const window = mainFrameWindow(event)
    const sample = value as PlaybackSample
    if (!sample || typeof sample.sessionId !== 'string' || sample.sessionId.length > 200 || !Number.isSafeInteger(sample.sequence) || sample.sequence < 1 || typeof sample.entryId !== 'string' || typeof sample.mediaId !== 'string' || !['image', 'video'].includes(sample.mediaType)) throw new Error('播放状态无效')
    const bounded: PlaybackSample = {
      sessionId: sample.sessionId, sequence: sample.sequence, entryId: sample.entryId.slice(0, 200), mediaId: sample.mediaId.slice(0, 200), mediaType: sample.mediaType,
      ready: sample.ready === true, playing: sample.playing === true, waiting: sample.waiting === true, seeking: sample.seeking === true, error: sample.error === true,
      positionMs: Number.isFinite(sample.positionMs) ? Math.min(31_536_000_000, Math.max(0, sample.positionMs)) : 0,
      durationMs: Number.isFinite(sample.durationMs) ? Math.min(31_536_000_000, Math.max(0, sample.durationMs)) : 0,
      imageElapsedMs: Number.isFinite(sample.imageElapsedMs) ? Math.min(120_000, Math.max(0, sample.imageElapsedMs)) : 0,
      playbackRate: Number.isFinite(sample.playbackRate) ? Math.min(2, Math.max(0.5, sample.playbackRate)) : 1
    }
    return playbackTracker?.sample(sample.sessionId, bounded, window) ?? { acceptedWallMs: 0, stats: null }
  })
  ipcMain.handle('playback:end-session', async (event, sessionId: unknown) => {
    mainFrameWindow(event)
    if (typeof sessionId !== 'string' || sessionId.length > 200) return null
    return playbackTracker?.end(sessionId) ?? null
  })
  const settings = await loadStoredSettings()
  const directory = resourceDirectoryFrom(settings)
  resourceRoot = directory.path
  deleteSourcesAfterImport = settings.deleteSourcesAfterImport === true
  activeSmartCoserSettings = smartCoserSettings(settings)
  await startImportManager(resourceRoot, deleteSourcesAfterImport)
  smartFolderCoserService = new SmartFolderCoserImportService(importManager, () => activeSmartCoserSettings)
  playbackTracker = new PlaybackTracker((checkpoint) => importManager.playbackCheckpoint(checkpoint))
  if (process.env['ELECTRON_RENDERER_URL']) console.info(`[startup-perf] media services initialized: ${Math.round(Date.now() - startupStartedAt)} ms after main process start`)
  protocol.handle('gallery-thumb', async (request) => {
    const hash = new URL(request.url).hostname
    if (!/^[a-f0-9]{64}$/.test(hash)) return new Response('Not found', { status: 404 })
    const thumbnailPath = join(resourceRoot, 'thumbnails', `${hash}.webp`)
    try {
      await access(thumbnailPath)
      return net.fetch(pathToFileURL(thumbnailPath).toString())
    } catch { return new Response('Not found', { status: 404 }) }
  })
  protocol.handle('gallery-media', async (request) => {
    const mediaId = new URL(request.url).hostname
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(mediaId)) return new Response('Not found', { status: 404 })
    try { return corsResponse(await createMediaResponse(await importManager.getMediaPath(mediaId), request.headers.get('range'))) }
    catch { return new Response('Not found', { status: 404 }) }
  })
  protocol.handle('gallery-coser-avatar', async (request) => {
    const coserId = new URL(request.url).hostname
    if (!COSER_ID_PATTERN.test(coserId)) return new Response('Not found', { status: 404 })
    try { await access(avatarPath(coserId)); return net.fetch(pathToFileURL(avatarPath(coserId)).toString()) }
    catch { return new Response('Not found', { status: 404 }) }
  })
  protocol.handle('gallery-app-asset', async (request) => {
    const assetPath = rendererAssetPath(request)
    if (!assetPath) return new Response('Not found', { status: 404 })
    try { await access(assetPath); return net.fetch(pathToFileURL(assetPath).toString()) }
    catch { return new Response('Not found', { status: 404 }) }
  })
  ipcMain.handle('media:import-files', (event, folderId: string | null = null) => importManager.importFiles(BrowserWindow.fromWebContents(event.sender) ?? BrowserWindow.getFocusedWindow()!, folderId))
  ipcMain.handle('media:import-folders', async (event, folderId: string | null = null) => {
    const owner = BrowserWindow.fromWebContents(event.sender) ?? BrowserWindow.getFocusedWindow()!
    if (folderId === null && activeSmartCoserSettings.enabled) {
      const paths = await importManager.chooseSmartFolderPaths(owner)
      return paths && smartFolderCoserService ? smartFolderCoserService.start(paths) : null
    }
    return importManager.importFolders(owner, folderId)
  })
  ipcMain.handle('media:import-dropped-folders', async (_event, payload: { paths: unknown; destination: unknown }) => {
    const destination = payload?.destination as { type?: unknown } | undefined
    if (destination?.type === 'library' && activeSmartCoserSettings.enabled && smartFolderCoserService) return smartFolderCoserService.start(payload?.paths)
    return importManager.importDroppedFolders(payload?.paths, payload?.destination)
  })
  ipcMain.handle('media:resolve-smart-folder-import', (_event, payload: { sessionId: string; decisions: SmartFolderImportDecision[] }) => {
    if (!smartFolderCoserService) throw new Error('智能归类服务尚未就绪')
    return smartFolderCoserService.resolve(payload?.sessionId, payload?.decisions)
  })
  ipcMain.handle('media:cancel-smart-folder-import', (_event, sessionId: string) => smartFolderCoserService?.cancel(sessionId) ?? null)
  ipcMain.handle('media:get-jobs', () => importManager.getJobs())
  ipcMain.handle('media:get-job', (_event, jobId: string) => importManager.getJob(jobId))
  ipcMain.handle('media:get-library', () => importManager.getLibrary())
  ipcMain.handle('media:get-folder-tree', () => importManager.getFolderTree())
  ipcMain.handle('media:get-album', (_event, albumId: string) => importManager.getAlbum(albumId))
  ipcMain.handle('media:get-folder', (_event, folderId: string) => importManager.getFolder(folderId))
  ipcMain.handle('media:create-folder', (_event, title: string, parentId: string | null) => importManager.createFolder(title, parentId))
  ipcMain.handle('media:move-media', (_event, mediaId: string, folderId: string | null) => importManager.moveMedia(mediaId, folderId))
  ipcMain.handle('media:move-album', (_event, albumId: string, folderId: string | null) => importManager.moveAlbum(albumId, folderId))
  ipcMain.handle('media:get-cosers', () => importManager.getCosers())
  ipcMain.handle('media:get-smart-coser-index', () => importManager.getSmartCoserIndex())
  ipcMain.handle('media:get-coser', (_event, coserId: string) => importManager.getCoser(coserId))
  ipcMain.handle('media:get-coser-avatar-media', (_event, coserId: string) => importManager.getCoserAvatarMedia(coserId))
  ipcMain.handle('media:create-coser', (_event, payload: { name: string; aliases: string[] }) => importManager.createCoser(payload.name, payload.aliases))
  ipcMain.handle('media:update-coser', (_event, payload: { id: string; name: string; aliases: string[] }) => importManager.updateCoser(payload.id, payload.name, payload.aliases))
  ipcMain.handle('media:delete-coser', async (_event, coserId: string) => { await importManager.deleteCoser(coserId); await rm(avatarPath(coserId), { force: true }) })
  ipcMain.handle('media:assign-videos-coser', (_event, payload: { mediaIds: string[]; coserId: string }) => importManager.assignVideosCoser(payload?.mediaIds, payload?.coserId))
  ipcMain.handle('media:undo-video-coser-assignment', (_event, operationId: string) => importManager.undoVideoCoserAssignment(operationId))
  ipcMain.handle('media:unassign-video-coser', (_event, mediaId: string) => importManager.unassignVideoCoser(mediaId))
  ipcMain.handle('media:assign-albums-coser', (_event, payload: { albumIds: string[]; coserId: string }) => importManager.assignAlbumsCoser(payload?.albumIds, payload?.coserId))
  ipcMain.handle('media:undo-album-coser-assignment', (_event, operationId: string) => importManager.undoAlbumCoserAssignment(operationId))
  ipcMain.handle('media:assign-album-coser', (_event, payload: { albumId: string; coserId: string }) => importManager.assignAlbumCoser(payload.albumId, payload.coserId))
  ipcMain.handle('media:unassign-album-coser', (_event, albumId: string) => importManager.unassignAlbumCoser(albumId))
  ipcMain.handle('coser:save-avatar', (_event, payload: { coserId: string; mediaId: string; crop: AvatarCrop }) => saveCoserAvatar(payload.coserId, payload.mediaId, payload.crop))
  ipcMain.handle('coser:clear-avatar', (_event, coserId: string) => clearCoserAvatar(coserId))
  ipcMain.handle('media:get-trash', () => importManager.getTrash())
  ipcMain.handle('media:retry-job', (_event, jobId: string) => importManager.retry(jobId))
  ipcMain.handle('media:rebuild-previews', () => importManager.rebuildPreviews())
  ipcMain.handle('media:retry-preview', (_event, mediaId: string) => importManager.retryPreview(mediaId))
  ipcMain.handle('media:trash-media', (_event, mediaId: string) => importManager.trashMedia(mediaId))
  ipcMain.handle('media:trash-album', (_event, albumId: string) => importManager.trashAlbum(albumId))
  ipcMain.handle('media:trash-folder', (_event, folderId: string) => importManager.trashFolder(folderId))
  ipcMain.handle('media:restore-media', (_event, mediaId: string) => importManager.restoreMedia(mediaId))
  ipcMain.handle('media:restore-album', (_event, albumId: string) => importManager.restoreAlbum(albumId))
  ipcMain.handle('media:restore-folder', (_event, folderId: string) => importManager.restoreFolder(folderId))
  ipcMain.handle('media:purge-trash', (_event, mediaId: string) => importManager.purgeTrash(mediaId))
  ipcMain.handle('media:purge-album', (_event, albumId: string) => importManager.purgeAlbum(albumId))
  ipcMain.handle('media:purge-folder', (_event, folderId: string) => importManager.purgeFolder(folderId))
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
  ipcMain.handle('settings:get-smart-coser-import', (): SmartFolderCoserSettings => activeSmartCoserSettings)
  ipcMain.handle('settings:set-smart-coser-import', async (_event, value: SmartFolderCoserSettings): Promise<SmartFolderCoserSettings> => {
    if (!value || typeof value.enabled !== 'boolean' || typeof value.model !== 'string' || !value.model.trim() || value.model.trim().length > 120) throw new Error('智能归类设置无效')
    validateOllamaBaseUrl(value.baseUrl)
    activeSmartCoserSettings = { enabled: value.enabled, baseUrl: value.baseUrl.replace(/\/$/, ''), model: value.model.trim() }
    await saveStoredSettings({ smartFolderCoserImport: activeSmartCoserSettings })
    return activeSmartCoserSettings
  })
  ipcMain.handle('settings:test-smart-coser-import', async (_event, baseUrl: string) => listOllamaModels(baseUrl))
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
let gracefulQuitInProgress = false
app.on('before-quit', (event) => {
  if (gracefulQuitInProgress) return
  event.preventDefault()
  gracefulQuitInProgress = true
  void (async () => {
    try { await playbackTracker?.flushAll() } catch (error) { console.error('无法保存最后的播放进度', error) }
    try { await importManager?.dispose() } finally { app.quit() }
  })()
})
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
