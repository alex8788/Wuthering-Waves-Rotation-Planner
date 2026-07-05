<script setup lang="ts">
// SidebarPanel.vue：側邊欄主容器 (提供 Tab 切換並渲染 GeneralBlockField 或 CustomBlockField)

import { ref } from 'vue'
import GeneralBlockField from '@/components/sidebar/GeneralBlockField.vue'
import CustomBlockField from '@/components/sidebar/CustomBlockField.vue'
import { SIDEBAR_ZONE_ATTRIBUTE } from '@/composables/useBlockDrag'

type TabId = 'general' | 'custom'

// 目前顯示的 Tab
const activeTab = ref<TabId>('general')

// label 為 i18n key（渲染時 $t 查表，隨語言切換）
const TABS: { id: TabId; labelKey: string }[] = [
  { id: 'general', labelKey: 'sidebar.presetTab' },
  { id: 'custom',  labelKey: 'sidebar.customTab' },
]
</script>

<template>
  <aside class="sidebar-panel" :[SIDEBAR_ZONE_ATTRIBUTE]="true" :aria-label="$t('sidebar.panelLabel')">

    <div class="segmented-control" role="tablist" :aria-label="$t('sidebar.switchTabsLabel')">
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
        {{ $t(tab.labelKey) }}
      </button>
    </div>

    <div class="tab-content">
      
      <div
        v-show="activeTab === 'general'"
        id="tabpanel-general"
        role="tabpanel"
        aria-labelledby="tab-general"
      >
        <GeneralBlockField />
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

<style scoped>
.sidebar-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  padding: 0 0.75rem;
  overflow-y: auto;
}

.segmented-control {
  display: flex;
  gap: 0.25rem;
  /* 右側預留 AppLayout 收合鈕的寬度，讓「預設／自訂」tab 不被絕對定位的
     收合鈕蓋住（三者同一橫列、同層並排）。 */
  padding: 0.5rem var(--app-toggle-reserve, 2.75rem) 0.5rem 0;
  flex-shrink: 0;
  border-bottom: 1px solid rgba(255, 255, 255, 0.07);
  margin-bottom: 0.25rem;
}

.segment-btn {
  flex: 1;
  padding: 0.3125rem 0;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 4px;
  background: transparent;
  color: rgba(255, 255, 255, 0.40);
  font-size: 0.6875rem;
  font-weight: 500;
  letter-spacing: 0.06em;
  cursor: pointer;
  transition: background 0.15s, color 0.15s, border-color 0.15s;
}

.segment-btn:hover,
.segment-btn:focus-visible {
  background: rgba(255, 255, 255, 0.06);
  color: rgba(255, 255, 255, 0.65);
}

/* 移除瀏覽器預設 focus ring（橘/白外框，非本專案實作） */
.segment-btn:focus {
  outline: none;
}

.segment-btn--active {
  background: rgba(255, 255, 255, 0.10);
  border-color: rgba(255, 255, 255, 0.28);
  color: rgba(255, 255, 255, 0.90);
}

.tab-content {
  flex: 1;
  overflow-y: auto;
}
</style>