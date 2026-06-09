<script setup lang="ts">
import { computed, onMounted, ref, shallowRef } from "vue";
import { useI18n } from "vue-i18n";

import { sendMessage } from "@/messages.ts";
import { useConfigStore } from "@/options/stores/config.ts";

const { t } = useI18n();
const configStore = useConfigStore();

interface AgentStatus {
  enabled: boolean;
  connected: boolean;
  state: string;
  lastError?: string;
  connectedAt?: number;
  lastSeenAt?: number;
}

const reconnecting = ref(false);
const status = shallowRef<AgentStatus>({
  enabled: false,
  connected: false,
  state: "idle",
  lastError: undefined,
  connectedAt: undefined,
  lastSeenAt: undefined,
});

const stateColor = computed(() => {
  if (status.value.connected) return "green";
  if (
    status.value.state === "retrying" ||
    status.value.state === "connecting" ||
    status.value.state === "authenticating"
  ) {
    return "orange";
  }
  if (status.value.state === "error") return "red";
  return "grey";
});

async function refreshStatus() {
  try {
    status.value = await sendMessage("elysiumAgentGetStatus", undefined);
  } catch (e: any) {
    console.debug("[PTD] Failed to get Elysium Agent status:", e);
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isPendingState(state: string) {
  return state === "retrying" || state === "connecting" || state === "authenticating";
}

async function reconnect() {
  reconnecting.value = true;
  try {
    await configStore.$save();
    await sendMessage("elysiumAgentReconnect", undefined);
    for (let i = 0; i < 10; i++) {
      await refreshStatus();
      if (!isPendingState(status.value.state)) break;
      await sleep(500);
    }
  } finally {
    reconnecting.value = false;
  }
}

function formatTime(time?: number) {
  return time ? new Date(time).toLocaleString() : "-";
}

defineExpose({
  afterSave: reconnect,
});

onMounted(() => {
  refreshStatus();
});
</script>

<template>
  <v-row>
    <v-col md="10" lg="8">
      <v-label class="my-2">{{ t("SetElysiumAgent.connection.title") }}</v-label>
      <v-card variant="tonal" class="mb-4 pa-4">
        <v-switch
          v-model="configStore.elysiumAgent.enabled"
          :label="t('SetElysiumAgent.connection.enabled')"
          color="primary"
          hide-details
          class="mb-3"
        />

        <v-text-field
          v-model="configStore.elysiumAgent.serverUrl"
          :label="t('SetElysiumAgent.connection.serverUrl')"
          placeholder="http://localhost:8088"
          :hint="t('SetElysiumAgent.connection.serverUrlHint')"
          persistent-hint
          prepend-inner-icon="mdi-server-network"
          variant="outlined"
          density="comfortable"
        />
        <v-text-field
          v-model="configStore.elysiumAgent.username"
          :label="t('SetElysiumAgent.connection.username')"
          prepend-inner-icon="mdi-account"
          variant="outlined"
          density="comfortable"
        />
        <v-text-field
          v-model="configStore.elysiumAgent.password"
          :label="t('SetElysiumAgent.connection.password')"
          prepend-inner-icon="mdi-lock"
          type="password"
          variant="outlined"
          density="comfortable"
        />

        <div class="d-flex align-center ga-3 flex-wrap">
          <v-chip :color="stateColor" variant="elevated" size="small">
            {{ status.connected ? t("SetElysiumAgent.status.connected") : t(`SetElysiumAgent.status.${status.state}`) }}
          </v-chip>
          <v-btn
            color="primary"
            variant="text"
            size="small"
            prepend-icon="mdi-connection"
            :loading="reconnecting"
            @click="reconnect"
          >
            {{ t("SetElysiumAgent.connection.reconnect") }}
          </v-btn>
          <v-btn color="primary" variant="text" size="small" prepend-icon="mdi-refresh" @click="refreshStatus">
            {{ t("SetElysiumAgent.connection.refresh") }}
          </v-btn>
        </div>

        <v-alert v-if="status.lastError" type="error" variant="tonal" density="compact" class="mt-3">
          {{ status.lastError }}
        </v-alert>
      </v-card>

      <v-label class="my-2">{{ t("SetElysiumAgent.runtime.title") }}</v-label>
      <v-card variant="tonal" class="pa-4">
        <v-list density="compact">
          <v-list-item :title="t('SetElysiumAgent.runtime.connectedAt')" :subtitle="formatTime(status.connectedAt)" />
          <v-list-item :title="t('SetElysiumAgent.runtime.lastSeenAt')" :subtitle="formatTime(status.lastSeenAt)" />
        </v-list>
      </v-card>
    </v-col>
  </v-row>
</template>
