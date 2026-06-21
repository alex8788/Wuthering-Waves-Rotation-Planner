<script setup lang="ts">
// SidebarPanel.vue：側邊欄主容器 (提供 Tab 切換並渲染 DefaultBlockField 或 CustomBlockField)

import { ref } from 'vue'
import DefaultBlockField from '@/components/sidebar/DefaultBlockField.vue'
import CustomBlockField from '@/components/sidebar/CustomBlockField.vue'

type TabId = 'default' | 'custom'

// 目前顯示的 Tab
const activeTab = ref<TabId>('default')

const TABS: { id: TabId; label: string }[] = [
  { id: 'default', label: '預設' },
  { id: 'custom',  label: '自訂' },
]
</script>

<template>
  <aside class="sidebar-panel" aria-label="區塊側邊欄">
    
    <div class="segmented-control" role="tablist" aria-label="切換區塊類型">
      <button
        v-for="tab in TABS"
        :key="tab.id"
        class="segment-btn"
        :class="{ 'segment-btn--active': activeTab === tab.id }"
        role="tab"
        :aria-selected="activeTab === tab.id"
        :aria-controls="`tabpanel-${tab.id}`"
        :id="`tab-${tab.id}`"
        @click="activeTab = tab.id"
      >
        {{ tab.label }}
      </button>
    </div>

    <div class="tab-content">
      
      <div
        v-show="activeTab === 'default'"
        id="tabpanel-default"
        role="tabpanel"
        aria-labelledby="tab-default"
      >
        <DefaultBlockField />
      </div>

      <div
        v-show="activeTab === 'custom'"
        id="tabpanel-custom"
        role="tabpanel"
        aria-labelledby="tab-custom"
      >
        <CustomBlockField />
      </div>

    </div>
  </aside>
</template>