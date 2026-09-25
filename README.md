# 幻视图库 / Local Gallery

本地优先的图片与视频图库整理工具基础项目。当前版本提供 Electron 桌面壳、Vue 3 界面骨架、深色主题、导航与安全 IPC 示例；尚未实现文件扫描、数据库和缩略图生成。

## 开发

PowerShell 若禁止执行 npm 脚本，请使用：

```powershell
npm.cmd install
npm.cmd run dev
```

可用命令：

- `npm.cmd run dev`：启动桌面开发环境
- `npm.cmd run typecheck`：运行 Vue / TypeScript 类型检查
- `npm.cmd run build`：执行类型检查并构建生产文件至 `out/`

## 架构

- `src/main`：Electron 主进程；未来的文件扫描、数据库与缩略图任务只在这里运行。
- `src/preload`：受控 IPC 桥梁。当前仅公开 `window.api.app.getVersion()`；`media`、`library`、`settings` 是预留命名空间。
- `src/renderer`：Vue 前端。路由页面、Pinia 状态和 shadcn-vue 风格基础组件均位于此处。

渲染进程启用了 `contextIsolation` 和 sandbox，不能直接访问 Node.js 或用户文件系统。原始媒体文件的安全默认策略会在后续导入功能中实现。
