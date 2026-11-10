import { create } from "zustand";

const MIN_ZOOM = 50;
const MAX_ZOOM = 150;
const ZOOM_STEP = 10;

type WorkspaceState = {
  zoom: number;
  increaseZoom: () => void;
  decreaseZoom: () => void;
  resetZoom: () => void;
};

const clampZoom = (value: number) =>
  Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, value));

/** 画布等纯客户端 UI 状态：刷新即重置，不进 URL、不进服务端缓存。 */
export const useWorkspaceStore = create<WorkspaceState>()((set) => ({
  zoom: 100,
  increaseZoom: () =>
    set((state) => ({ zoom: clampZoom(state.zoom + ZOOM_STEP) })),
  decreaseZoom: () =>
    set((state) => ({ zoom: clampZoom(state.zoom - ZOOM_STEP) })),
  resetZoom: () => set({ zoom: 100 }),
}));
