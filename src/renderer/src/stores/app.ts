import { defineStore } from 'pinia'
import { ref, watch } from 'vue'
export const useAppStore = defineStore('app', () => {
  const theme = ref<'dark' | 'light'>((localStorage.getItem('gallery-theme') as 'dark' | 'light') || 'dark')
  const sidebarCollapsed = ref(false)
  const sidebarWidth = ref(Number(localStorage.getItem('gallery-sidebar-width')) || 240)
  watch(theme, value => {
    document.documentElement.classList.toggle('dark', value === 'dark')
    localStorage.setItem('gallery-theme', value)
  }, { immediate: true })
  function toggleSidebar(): void { sidebarCollapsed.value = !sidebarCollapsed.value }
  function setSidebarWidth(value: number): void {
    sidebarWidth.value = Math.min(360, Math.max(220, value))
    localStorage.setItem('gallery-sidebar-width', String(sidebarWidth.value))
  }
  function setTheme(value: 'dark' | 'light'): void { theme.value = value }
  function toggleTheme(): void { theme.value = theme.value === 'dark' ? 'light' : 'dark' }
  return { theme, sidebarCollapsed, sidebarWidth, toggleSidebar, setSidebarWidth, setTheme, toggleTheme }
})
