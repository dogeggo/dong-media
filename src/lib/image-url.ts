/**
 * 图片代理 URL 处理保持为独立轻量模块，避免只显示图片的页面加载
 * 中文转换、HTML 解码和 HLS 测速等无关工具。
 */
export function processImageUrl(originalUrl: string): string {
  if (!originalUrl || originalUrl.startsWith('/')) return originalUrl;
  return `/api/image-proxy?url=${encodeURIComponent(originalUrl)}`;
}
