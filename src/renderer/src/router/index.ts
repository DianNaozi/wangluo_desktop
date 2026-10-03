import { createRouter, createWebHashHistory } from 'vue-router'
import LibraryPage from '../pages/LibraryPage.vue'
import AlbumDetailPage from '../pages/AlbumDetailPage.vue'
import FolderDetailPage from '../pages/FolderDetailPage.vue'
import TrashPage from '../pages/TrashPage.vue'
import CosersPage from '../pages/CosersPage.vue'
import StatisticsPage from '../pages/StatisticsPage.vue'
import SettingsPage from '../pages/SettingsPage.vue'
const routes = [
  { path: '/', redirect: '/library' },
  { path: '/library', name: 'library', component: LibraryPage, meta: { title: '媒体库' } },
  { path: '/albums/:id', name: 'album-detail', component: AlbumDetailPage, meta: { title: '图集详情' } },
  { path: '/folders/:id', name: 'folder-detail', component: FolderDetailPage, meta: { title: '文件夹详情' } },
  { path: '/albums', redirect: '/library' },
  { path: '/trash', name: 'trash', component: TrashPage, meta: { title: '回收站' } },
  { path: '/cosers', name: 'cosers', component: CosersPage, meta: { title: 'Coser' } },
  { path: '/cosers/:id', name: 'coser-detail', redirect: to => ({ name: 'cosers', query: { coser: String(to.params.id) } }) },
  { path: '/tags', redirect: '/library' },
  { path: '/timeline', redirect: '/library' },
  { path: '/statistics', name: 'statistics', component: StatisticsPage, meta: { title: '观看成长' } },
  { path: '/storage', redirect: '/library' },
  { path: '/folders', redirect: '/library' },
  { path: '/settings', name: 'settings', component: SettingsPage, meta: { title: '设置' } }
]
export default createRouter({ history: createWebHashHistory(), routes })
