import { create } from "zustand";

import { pullChanges, pushQueue, getSyncStats, forceSyncAll } from "@/lib/sync";

interface SyncStore {
  isOnline: boolean;
  isSyncing: boolean;
  lastSync: number | null;
  pendingCount: number;
  failedCount: number;

  // Actions
  startSync: () => Promise<void>;
  forceSync: () => Promise<void>;
  updateStats: () => Promise<void>;
  setOnline: (online: boolean) => void;
}

export const useSyncStore = create<SyncStore>((set, get) => ({
  isOnline: navigator.onLine,
  isSyncing: false,
  lastSync: null,
  pendingCount: 0,
  failedCount: 0,

  startSync: async () => {
    if (!get().isOnline || get().isSyncing) return;

    set({ isSyncing: true });
    try {
      await pullChanges();
      await pushQueue();
      await get().updateStats();
      set({ lastSync: Date.now() });
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error("Error during sync:", error);
    } finally {
      set({ isSyncing: false });
    }
  },

  forceSync: async () => {
    set({ isSyncing: true });
    try {
      await forceSyncAll();
      await get().updateStats();
      set({ lastSync: Date.now() });
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error("Error during force sync:", error);
    } finally {
      set({ isSyncing: false });
    }
  },

  updateStats: async () => {
    const stats = await getSyncStats();

    set({
      pendingCount: stats.pending,
      failedCount: stats.failed,
    });
  },

  setOnline: (online: boolean) => {
    set({ isOnline: online });
    if (online) {
      get().startSync();
    }
  },
}));

// Auto-sync cada 30 segundos
setInterval(() => {
  const { isOnline, isSyncing, startSync } = useSyncStore.getState();

  if (isOnline && !isSyncing) {
    startSync();
  }
}, 30000);

// Listener de conectividad
window.addEventListener("online", () =>
  useSyncStore.getState().setOnline(true),
);
window.addEventListener("offline", () =>
  useSyncStore.getState().setOnline(false),
);
