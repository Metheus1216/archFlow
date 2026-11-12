import { BrandMark } from "@/components/logo";

/** 固定行数只为占位，不对应真实数据；用常量避免每次渲染重建数组。 */
const SKELETON_ROWS = [0, 1, 2, 3];

/**
 * 侧栏项目树流式加载时的占位骨架。
 *
 * 结构与 `Sidebar` 的头部 / 列表区保持一致，数据到达后不会发生布局跳动。
 */
export const SidebarSkeleton = () => (
  <aside
    aria-busy="true"
    aria-label="项目列表加载中"
    className="flex h-full min-h-0 flex-col border-r border-border bg-background"
  >
    <div className="shrink-0 px-4 pb-4 pt-5">
      <div className="flex items-center gap-2.5">
        <BrandMark />
        <span className="text-sm font-semibold tracking-tight">ArchFlow</span>
      </div>

      <div className="mt-5 space-y-2">
        <div className="h-9 animate-pulse rounded-md bg-muted" />
        <div className="h-9 animate-pulse rounded-md bg-muted" />
      </div>
    </div>

    <div className="mx-4 border-t border-border" />

    <div className="space-y-2 px-2 py-3">
      {SKELETON_ROWS.map((row) => (
        <div key={row} className="h-8 animate-pulse rounded-md bg-muted" />
      ))}
    </div>
  </aside>
);
