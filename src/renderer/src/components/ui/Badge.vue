<script setup lang="ts">import { cn } from '@/lib/utils'; defineProps<{ class?: string }>()</script>
<template><span :class="cn('inline-flex items-center rounded-md bg-zinc-800 px-2 py-0.5 text-xs font-medium text-zinc-300', $props.class)"><slot /></span></template>
