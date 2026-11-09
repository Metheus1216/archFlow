/**
 * 允许在 TS 中副作用导入全局样式（如 app/layout.tsx 的 `import "./globals.css"`）。
 * CSS 由 Next.js 在构建时处理，这里只为 IDE / tsc 提供模块声明。
 */
declare module "*.css";
