/**
 * TODO: 全局 Fetch 拦截器与 TanStack Query 配置。
 *
 * 计划实现：
 *   - request<T>(path, init)：base URL 拼接、统一响应外壳解析
 *   - 401 TOKEN_EXPIRED：挂起请求 → 并发去重刷新 → 重放一次
 *   - QueryClient 默认配置（staleTime、retry）
 */
export {};
