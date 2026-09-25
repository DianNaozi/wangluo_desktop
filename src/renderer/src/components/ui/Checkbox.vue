<script setup lang="ts">const model = defineModel<boolean>({ default: false })</script>
<template><input v-model="model" type="checkbox" class="size-4 rounded border-zinc-700 bg-surface accent-violet-500" /></template>
