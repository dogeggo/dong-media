/**
 * 图片代理 URL 处理保持为独立轻量模块，避免只显示图片的页面加载
 * 中文转换、HTML 解码和 HLS 测速等无关工具。
 */
export function processImageUrl(originalUrl: string): string {
  const value = originalUrl.trim();

  if (!value || (value.startsWith('/') && !value.startsWith('//'))) {
    return originalUrl;
  }

  const normalizedUrl = value.startsWith('//') ? `https:${value}` : value;

  try {
    const parsed = new URL(normalizedUrl);
    if (!['http:', 'https:'].includes(parsed.protocol)) return originalUrl;
    return `/api/image-proxy?url=${encodeURIComponent(parsed.toString())}`;
  } catch {
    return originalUrl;
  }
}
