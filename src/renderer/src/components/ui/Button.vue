<script setup lang="ts">
import { computed } from 'vue'
import { cn } from '@/lib/utils'
const props = withDefaults(defineProps<{ variant?: 'default' | 'ghost' | 'outline'; size?: 'default' | 'sm'; class?: string }>(), { variant: 'default', size: 'default' })
const styles = computed(() => cn('inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:pointer-events-none disabled:opacity-50', props.variant === 'default' && 'bg-accent-strong text-white hover:bg-violet-500', props.variant === 'ghost' && 'text-zinc-400 hover:bg-surface-hover hover:text-white', props.variant === 'outline' && 'border border-line bg-surface text-zinc-200 hover:bg-surface-hover', props.size === 'default' ? 'h-9 px-3.5 text-sm' : 'h-8 px-2.5 text-xs', props.class))
</script>
<template><button :class="styles"><slot /></button></template>
