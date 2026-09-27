import { createRouter, createWebHashHistory } from 'vue-router'
import InboxPage from '../pages/InboxPage.vue'
import LibraryPage from '../pages/LibraryPage.vue'
import AlbumDetailPage from '../pages/AlbumDetailPage.vue'
import FolderDetailPage from '../pages/FolderDetailPage.vue'
import TrashPage from '../pages/TrashPage.vue'
import CosersPage from '../pages/CosersPage.vue'
import TagsPage from '../pages/TagsPage.vue'
import StatisticsPage from '../pages/StatisticsPage.vue'
import SettingsPage from '../pages/SettingsPage.vue'
import TimelinePage from '../pages/TimelinePage.vue'
import StoragePage from '../pages/StoragePage.vue'
import PlaceholderPage from '../pages/PlaceholderPage.vue'
const routes = [
  { path: '/', name: 'home', component: InboxPage, meta: { title: '首页' } },
  { path: '/library', name: 'library', component: LibraryPage, meta: { title: '媒体库' } },
  { path: '/albums/:id', name: 'album-detail', component: AlbumDetailPage, meta: { title: '图集详情' } },
  { path: '/folders/:id', name: 'folder-detail', component: FolderDetailPage, meta: { title: '文件夹详情' } },
  { path: '/albums', redirect: '/library' },
  { path: '/trash', name: 'trash', component: TrashPage, meta: { title: '回收站' } },
  { path: '/cosers', name: 'cosers', component: CosersPage, meta: { title: 'Coser' } },
  { path: '/cosers/:id', name: 'coser-detail', redirect: to => ({ name: 'cosers', query: { coser: String(to.params.id) } }) },
  { path: '/tags', name: 'tags', component: TagsPage, meta: { title: '标签' } },
  { path: '/timeline', name: 'timeline', component: TimelinePage, meta: { title: '时间轴' } },
  { path: '/statistics', name: 'statistics', component: StatisticsPage, meta: { title: '统计数据' } },
  { path: '/storage', name: 'storage', component: StoragePage, meta: { title: '存储空间' } },
  { path: '/folders', redirect: '/library' },
  { path: '/settings', name: 'settings', component: SettingsPage, meta: { title: '设置' } }
]
export default createRouter({ history: createWebHashHistory(), routes })
