<script setup lang="ts">import { cn } from '@/lib/utils'; defineProps<{ class?: string }>()</script>
<template><input :class="cn('h-9 w-full rounded-lg border border-line bg-surface px-3 text-sm text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-violet-500', $props.class)" /></template>
