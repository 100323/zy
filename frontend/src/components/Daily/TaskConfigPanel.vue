<template>
  <div class="task-config-panel" v-if="initialized">
    <div class="panel-header">
      <h3>{{ title }}</h3>
      <div class="header-actions">
        <n-button size="small" @click="expandAll">展开全部</n-button>
        <n-button size="small" @click="collapseAll">折叠全部</n-button>
        <n-button size="small" type="primary" @click="resetToDefault">恢复默认</n-button>
      </div>
    </div>

    <div class="task-groups">
      <n-collapse v-model:expanded-names="expandedGroups">
        <n-collapse-item
          v-for="group in taskGroupDefinitions"
          :key="group.name"
          :name="group.name"
        >
          <template #header>
            <div class="group-header">
              <span class="group-icon">{{ group.icon }}</span>
              <span class="group-label">{{ group.label }}</span>
              <n-tag size="small" :type="getGroupEnabledCount(group.name) > 0 ? 'success' : 'default'">
                {{ getGroupEnabledCount(group.name) }}/{{ getGroupTotalCount(group.name) }}
              </n-tag>
            </div>
          </template>

          <div class="task-list">
            <div
              v-for="task in getGroupTasks(group.name)"
              :key="task.value"
              class="task-item"
            >
              <div class="task-header">
                <div class="task-info">
                  <n-switch
                    v-model:value="getTaskConfig(task.value).enabled"
                    size="small"
                  />
                  <span class="task-label">{{ task.label }}</span>
                  <n-tooltip v-if="task.description" trigger="hover" placement="right" :content-style="{ maxWidth: '280px', whiteSpace: 'pre-line' }">
                    <template #trigger>
                      <n-icon size="14" color="#86909c">
                        <InformationCircle />
                      </n-icon>
                    </template>
                    {{ task.description }}
                  </n-tooltip>
                </div>
                <n-button
                  v-if="task.configFields && task.configFields.length > 0"
                  size="tiny"
                  text
                  @click="toggleTaskConfig(task.value)"
                >
                  {{ isTaskExpanded(task.value) ? '收起配置' : '展开配置' }}
                  <n-icon>
                    <ChevronUp v-if="isTaskExpanded(task.value)" />
                    <ChevronDown v-else />
                  </n-icon>
                </n-button>
              </div>

              <n-collapse-transition :show="isTaskExpanded(task.value) && task.configFields && task.configFields.length > 0">
                <div class="task-config-fields">
                  <div
                    v-for="field in task.configFields"
                    :key="field.key"
                    class="config-field"
                  >
                    <label class="field-label">
                      {{ field.label }}
                      <n-tooltip v-if="field.description" trigger="hover">
                        <template #trigger>
                          <n-icon size="12" color="#86909c">
                            <InformationCircle />
                          </n-icon>
                        </template>
                        {{ field.description }}
                      </n-tooltip>
                    </label>

                    <div class="field-input">
                      <n-select
                        v-if="field.type === 'select'"
                        v-model:value="getTaskConfig(task.value).config[field.key]"
                        :options="getOptionByRef(field.options)"
                        size="small"
                        :placeholder="`请选择${field.label}`"
                      />
                      <n-input-number
                        v-else-if="field.type === 'number'"
                        v-model:value="getTaskConfig(task.value).config[field.key]"
                        :min="field.min"
                        :max="field.max"
                        size="small"
                        :placeholder="`请输入${field.label}`"
                      />
                      <n-switch
                        v-else-if="field.type === 'switch'"
                        v-model:value="getTaskConfig(task.value).config[field.key]"
                        size="small"
                      />
                      <n-input
                        v-else
                        v-model:value="getTaskConfig(task.value).config[field.key]"
                        size="small"
                        :placeholder="`请输入${field.label}`"
                      />
                    </div>
                  </div>
                </div>
              </n-collapse-transition>
            </div>
          </div>
        </n-collapse-item>
      </n-collapse>
    </div>

    <div class="panel-footer">
      <n-button @click="handleCancel">取消</n-button>
      <n-button type="primary" @click="handleSave">保存配置</n-button>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted, nextTick } from 'vue';
import {
  taskGroupDefinitions,
  taskConfigDefinitions,
  defaultTaskConfigs,
  formationOptions,
  bossTimesOptions,
  boxTypeOptions,
  fishTypeOptions,
} from '@/utils/batch/constants';
import { InformationCircle, ChevronUp, ChevronDown } from '@vicons/ionicons5';

const props = defineProps({
  title: {
    type: String,
    default: '任务配置',
  },
  modelValue: {
    type: Object,
    default: () => ({}),
  },
});

const emit = defineEmits(['update:modelValue', 'save', 'cancel']);

const initialized = ref(false);
const expandedGroups = ref(['daily', 'dungeon', 'resource']);
const expandedTasks = ref([]);
const taskConfigs = ref({});

const optionRefs = {
  formationOptions,
  bossTimesOptions,
  boxTypeOptions,
  fishTypeOptions,
};

const getOptionByRef = (refName) => {
  return optionRefs[refName] || [];
};

const getTaskConfig = (taskValue) => {
  if (!taskConfigs.value[taskValue]) {
    taskConfigs.value[taskValue] = JSON.parse(
      JSON.stringify(defaultTaskConfigs[taskValue] || {
        enabled: true,
        config: {},
        scheduleType: 'daily',
        runTime: null,
        intervalHours: 4,
      }),
    );
  }
  return taskConfigs.value[taskValue];
};

const getGroupTasks = (groupName) => {
  return Object.entries(taskConfigDefinitions)
    .filter(([value, config]) => value !== 'startBatch' && config.group === groupName)
    .map(([value, config]) => ({
      value,
      ...config,
    }));
};

const getGroupEnabledCount = (groupName) => {
  const tasks = getGroupTasks(groupName);
  return tasks.filter((task) => {
    const config = taskConfigs.value[task.value];
    return config?.enabled ?? task.defaultEnabled;
  }).length;
};

const getGroupTotalCount = (groupName) => {
  return getGroupTasks(groupName).length;
};

const isTaskExpanded = (taskValue) => {
  return expandedTasks.value.includes(taskValue);
};

const toggleTaskConfig = (taskValue) => {
  const index = expandedTasks.value.indexOf(taskValue);
  if (index > -1) {
    expandedTasks.value.splice(index, 1);
  } else {
    expandedTasks.value.push(taskValue);
  }
};

const expandAll = () => {
  expandedGroups.value = taskGroupDefinitions.map((g) => g.name);
  expandedTasks.value = Object.keys(taskConfigDefinitions);
};

const collapseAll = () => {
  expandedGroups.value = [];
  expandedTasks.value = [];
};

const resetToDefault = () => {
  taskConfigs.value = JSON.parse(JSON.stringify(defaultTaskConfigs));
};

const handleSave = () => {
  emit('update:modelValue', JSON.parse(JSON.stringify(taskConfigs.value)));
  emit('save', taskConfigs.value);
};

const handleCancel = () => {
  emit('cancel');
};

const initializeConfigs = () => {
  const newConfigs = {};

  Object.keys(taskConfigDefinitions).forEach((key) => {
    if (props.modelValue && props.modelValue[key]) {
      newConfigs[key] = {
        enabled: props.modelValue[key].enabled ?? defaultTaskConfigs[key]?.enabled ?? true,
        config: {
          ...(defaultTaskConfigs[key]?.config || {}),
          ...(props.modelValue[key].config || {}),
        },
        scheduleType: props.modelValue[key].scheduleType || defaultTaskConfigs[key]?.scheduleType || 'daily',
        runTime: props.modelValue[key].runTime || defaultTaskConfigs[key]?.runTime || null,
        intervalHours: props.modelValue[key].intervalHours ?? defaultTaskConfigs[key]?.intervalHours ?? 4,
      };
    } else {
      newConfigs[key] = {
        ...(JSON.parse(JSON.stringify(defaultTaskConfigs[key] || {
          enabled: true,
          config: {},
          scheduleType: 'daily',
          runTime: null,
          intervalHours: 4,
        }))),
      };
    }
  });

  taskConfigs.value = newConfigs;
  initialized.value = true;
};

watch(
  () => props.modelValue,
  (newVal) => {
    if (newVal && Object.keys(newVal).length > 0) {
      initializeConfigs();
    }
  },
  { deep: true }
);

onMounted(() => {
  nextTick(() => {
    initializeConfigs();
  });
});
</script>

<style scoped lang="scss">
.task-config-panel {
  display: flex;
  flex-direction: column;
  gap: 16px;
  max-height: 70vh;
  overflow: hidden;
}

.panel-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--border-light);

  h3 {
    margin: 0;
    font-size: 16px;
    font-weight: 600;
  }

  .header-actions {
    display: flex;
    gap: 8px;
  }
}

.task-groups {
  flex: 1;
  overflow-y: auto;
}

.group-header {
  display: flex;
  align-items: center;
  gap: 8px;

  .group-icon {
    font-size: 16px;
  }

  .group-label {
    font-weight: 500;
  }
}

.task-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 8px 0;
}

.task-item {
  padding: 12px;
  background: var(--bg-secondary);
  border-radius: 8px;
  border: 1px solid var(--border-light);
}

.task-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.task-info {
  display: flex;
  align-items: center;
  gap: 8px;

  .task-label {
    font-size: 14px;
    font-weight: 500;
  }
}

.task-config-fields {
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px dashed var(--border-light);
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.config-field {
  display: flex;
  align-items: center;
  gap: 12px;

  .field-label {
    min-width: 120px;
    font-size: 13px;
    color: var(--text-secondary);
    display: flex;
    align-items: center;
    gap: 4px;
  }

  .field-input {
    flex: 1;
    max-width: 200px;
  }
}

.panel-footer {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  padding-top: 12px;
  border-top: 1px solid var(--border-light);
}

.tooltip-content {
  max-width: 280px;
  white-space: pre-line;
  word-break: break-all;
  line-height: 1.5;
  font-size: 12px;
}
</style>
