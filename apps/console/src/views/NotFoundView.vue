<script setup lang="ts">
import { NButton, NCard, NEmpty } from 'naive-ui';
import { useRouter } from 'vue-router';

const router = useRouter();
</script>

<template>
  <n-card title="页面不存在" class="gap">
    <n-empty description="这个地址没有对应的页面，可能链接已过期。" />
    <n-button class="gap" type="primary" @click="router.push('/overview')">回到工作台</n-button>
  </n-card>
</template>
