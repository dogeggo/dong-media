# LunaTV 首页性能改进清单

> 目标站点：<https://tv.dogegg.online>  
> 诊断日期：2026-08-05  
> 适用范围：首页、Hero 轮播、首页推荐区、继续观看、图片/视频代理、Next.js 路由预取与部署链路

## 1. 文档目的

本文档用于跟踪 LunaTV 首页加载性能优化工作。清单基于桌面 Chrome 的真实网络和页面运行数据生成，重点解决以下用户感知问题：

- 首次访问时长时间显示占位内容；
- 首页已经可见，但 Hero 标题、描述和图片仍继续变化；
- 页面 `load` 事件结束后仍持续发出大量请求；
- 低吞吐或高延迟网络下，海报、轮播视频和路由预取互相争抢带宽；
- 暖缓存下仍存在较长的主线程阻塞任务。

状态约定：

- `[ ]`：尚未开始；
- `[-]`：正在实施；
- `[x]`：已完成并通过验收；
- `[!]`：存在阻塞，需要补充决策或外部条件。

## 2. 当前性能基线

### 2.1 实验室数据

冷加载测试使用“禁用浏览器缓存 + 绕过 Service Worker”，暖加载使用正常浏览器缓存。

| 指标           |         冷加载 |         暖缓存重载 | 当前结论                          |
| -------------- | -------------: | -----------------: | --------------------------------- |
| TTFB           |          576ms |              314ms | HTML 响应不是首要瓶颈             |
| FCP            |         2.700s |             0.804s | 冷加载需改进                      |
| LCP            |        16.452s |             2.532s | 冷加载严重超标；暖缓存略高于 2.5s |
| `load` 事件    |        11.059s |             1.682s | 冷加载静态资源阶段很慢            |
| CLS            |          0.027 |              0.027 | 良好                              |
| 最长主线程任务 |           93ms |              643ms | 暖缓存仍有明显阻塞风险            |
| 首页 RSC 预取  |     未单独计数 |              25 个 | 预取明显过量                      |
| 页面后台活动   | 图片最迟约 42s | RSC 持续到约 10.6s | `load` 后仍长期繁忙               |

### 2.2 已确认的关键证据

- 首页是完整 Client Component，推荐数据只能在 JavaScript 下载和 Hydration 后请求。
- 冷加载时，首页推荐 API 约在第 11.08 秒才开始。
- Hero 的 6 个详情请求按每批 2 个执行，最后一批约在第 16.36 秒完成。
- Hero 描述约在第 16.45 秒渲染，并成为冷加载最终 LCP。
- 暖加载期间捕获到 44 个 `fetch`，其中 25 个为带 `_rsc=` 的 Next.js 路由预取。
- 暖加载 Hero 图片约在 1.02 秒完成下载，但直到 2.53 秒才成为 LCP，存在约 1.51 秒渲染延迟。
- 初始脚本约 236KB 压缩、778KB 解压；主阻塞 CSS 约 38.8KB 压缩、374KB 解压。
- 当前连接命中 Cloudflare `SJC` 节点；静态资源是 `HIT`，但单请求 TTFB 仍约 0.6～0.8 秒。
- 首页存在 1.49MB 的小尺寸卡片 PNG，并被设置为高优先级加载。
- Hero 视频代理出现重复 404/500，并带有客户端重试行为。

## 3. 总体验收目标

以下目标用于判断首页性能优化是否真正完成，而不是只完成代码修改。

### 3.1 实验室目标

- [ ] 冷加载 FCP ≤ 1.8s；若当前跨洋链路暂时无法达到，第一阶段至少 ≤ 2.2s。
- [ ] 冷加载 LCP 第一阶段 ≤ 4.0s，最终目标 ≤ 2.5s。
- [ ] 暖缓存 LCP ≤ 2.2s，并稳定留出性能余量。
- [ ] CLS ≤ 0.1，且不得因延迟加载推荐区而回退。
- [ ] 首屏关键路径内不出现持续时间超过 200ms 的主线程长任务。
- [ ] 页面空闲前的 Next RSC 自动预取由 25 个降至 0～3 个。
- [ ] 用户没有导航意图时，不预取动态 `/play?...` 页面。
- [ ] Hero 详情请求由 6 个降至 0～1 个，或合并为一个批量请求。
- [ ] LCP 前只允许一张图片使用高优先级。
- [ ] LCP 前不发起轮播视频请求。
- [ ] 首屏实际需要传输的压缩资源控制在 500KB 以内；后续根据 RUM 数据继续收紧。

### 3.2 真实用户目标

- [ ] 接入真实用户 Web Vitals 上报。
- [ ] 分别统计移动端与桌面端数据。
- [ ] 分别统计中国大陆、东亚和其他地区数据。
- [ ] p75 LCP ≤ 2.5s。
- [ ] p75 INP ≤ 200ms。
- [ ] p75 CLS ≤ 0.1。
- [ ] p75 TTFB ≤ 800ms；亚洲主要用户目标建议进一步收紧到 400ms 左右。

## 4. P0：停止过量的 Next.js 路由预取

相关代码：

- [`src/components/FastLink.tsx`](src/components/FastLink.tsx)
- [`src/components/ModernNav.tsx`](src/components/ModernNav.tsx)
- [`src/components/HeroBanner.tsx`](src/components/HeroBanner.tsx)
- [`src/components/home/HomeRecommendationSections.tsx`](src/components/home/HomeRecommendationSections.tsx)

当前问题：

- `FastLink` 注释声称默认关闭预取，实际硬编码 `prefetch={true}`。
- `ModernNav` 的多个路由在进入视口后被完整预取。
- Hero 的播放/更多信息链接会预取带动态查询参数的页面。
- 推荐区多个“查看更多”链接继续触发默认视口预取。
- 正常缓存重载仍捕获到 25 个 RSC 请求，且存在相同目标的重复请求。
- 这些响应大多为 `private, no-cache, no-store`，Cloudflare 无法直接复用。

实施清单：

- [ ] 给 `FastLinkProps` 增加显式 `prefetch` 配置。
- [ ] 将 `FastLink` 默认值改为 `prefetch={false}`。
- [ ] 修正 `FastLink` 中与实际行为不一致的注释。
- [ ] 为顶部导航确定最多 1～2 个真正需要预取的高概率目标。
- [ ] Hero 的动态 `/play?...` 链接默认关闭预取。
- [ ] Hero 的“更多信息”链接默认关闭视口预取。
- [ ] 推荐区所有视口外“查看更多”链接设置 `prefetch={false}`。
- [ ] 如需保留快速导航，实现“首次 hover/focus 后再恢复默认预取”的链接组件。
- [ ] 对重复路径建立页面级去重检查，避免多个可见组件同时预取同一路由。

验收方法：

- [ ] 使用生产构建测试，不能只在 `next dev` 下验证，因为 Next.js 生产环境预取行为不同。
- [ ] 首页打开后不做任何交互并等待 15 秒。
- [ ] 检查所有带 `_rsc=` 的请求数量。
- [ ] 确认没有自动请求 `/play?...&_rsc=...`。
- [ ] 确认未点击导航时，RSC 自动请求总数为 0～3 个。
- [ ] 对链接执行 hover/focus 后，确认仅预取对应目标一次。

## 5. P0：首页首屏改为服务端输出或服务端聚合

相关代码：

- [`src/app/page.tsx`](src/app/page.tsx)
- [`src/hooks/useHomeRecommendations.ts`](src/hooks/useHomeRecommendations.ts)
- [`src/lib/home-api.ts`](src/lib/home-api.ts)
- [`src/components/home/HomeRecommendationSections.tsx`](src/components/home/HomeRecommendationSections.tsx)

当前问题：

- `src/app/page.tsx` 顶层使用 `'use client'`。
- 推荐数据必须等待 JavaScript 执行后才能开始请求。
- 浏览器当前需要并行请求四个豆瓣分类、短剧、新番和上映日历。
- 基础列表返回后，还要再发出 6 个 Hero 详情请求。
- `fetchHeroDetails` 每批处理 2 个 ID，共形成 3 批串行请求。
- React Query 只有等全部批次完成后才能一次性收到详情结果。
- `refetchOnMount: 'always'` 会削弱 `staleTime` 的缓存价值。

推荐架构：

- Server Component 页面负责输出公共推荐首屏；
- 服务端并行读取电影、剧集、综艺、动漫及 Hero 首项；
- 使用 Suspense/流式 RSC 分段输出非关键推荐区；
- “继续观看、收藏、用户菜单、轮播控制和视频播放”保留为客户端组件；
- 对公共推荐结果使用现有服务端缓存系统；
- 不把用户私有数据混入可共享的公共推荐缓存。

实施清单：

- [ ] 将首页公共内容从完整 Client Component 中拆出。
- [ ] 设计服务端首页数据模型，只包含首屏真正需要的字段。
- [ ] 在服务端并行获取首页分类数据。
- [ ] 优先只获取第一张 Hero 的完整详情。
- [ ] 把 `backdrop`、`plot_summary`、`year`、`rate`、`trailerAvailable` 合并到首屏 Hero 数据。
- [ ] 评估新增单一 `/api/home` 聚合接口，或直接在 Server Component 内调用服务层函数。
- [ ] 禁止服务端组件通过公开 HTTP 地址回调自身 API；优先复用底层服务函数。
- [ ] 删除 6 个客户端 Hero 详情请求，或替换成单一批量详情请求。
- [ ] 将非首屏推荐区放入独立 Suspense 边界。
- [ ] 移除不必要的 `refetchOnMount: 'always'`，让 5 分钟 `staleTime` 生效。
- [ ] 保留手动刷新按钮的显式 `refetch` 能力。
- [ ] 为首页聚合/服务端取数增加错误降级和超时控制。
- [ ] 确认某个推荐数据源失败时不会阻塞整个首页流式返回。

验收方法：

- [ ] 在禁用缓存条件下确认 Hero 标题随首个 HTML/RSC 流到达，而不是等待 Hydration。
- [ ] 首页推荐 API 不再统一延迟到 `load` 事件附近才开始。
- [ ] Hero 详情网络请求为 0～1 个。
- [ ] Hero 描述不再于页面加载十几秒后突然出现。
- [ ] 冷加载最终 LCP 不再由迟到的 Hero 描述文本触发。
- [ ] 模拟一个推荐数据源超时，首页其他区域仍能正常显示。

## 6. P0：消除 Hero LCP 的人为渲染延迟

相关代码：

- [`src/components/HeroBanner.tsx`](src/components/HeroBanner.tsx)

当前问题：

- Hero 图片初始使用 `opacity-0`。
- 图片加载后先更新 React 状态，再执行 700ms 透明度动画。
- 暖缓存实测图片在约 1.02 秒完成加载，但在约 2.53 秒才成为 LCP。
- 渲染延迟与 643ms 主线程长任务重叠，进一步推迟首屏绘制。

实施清单：

- [ ] 第一张 Hero 图片默认可见，不从 `opacity-0` 开始。
- [ ] 让占位层淡出，而不是让 LCP 图片淡入。
- [ ] 如必须保留淡入，将首张 Hero 过渡时间控制在 100～150ms。
- [ ] 非当前轮播图可以保留较长动画，但不得影响首张 LCP 图。
- [ ] 避免依赖 `onLoad → setState → render` 才显示首张图片。
- [ ] 检查深色遮罩和渐变是否足以避免图片加载瞬间的视觉闪烁。
- [ ] 在 `prefers-reduced-motion` 下完全关闭非必要动画。

验收方法：

- [ ] 对比 LCP 条目的 `loadTime` 与 `renderTime`。
- [ ] Hero 图片渲染延迟控制在 200ms 以内。
- [ ] 暖缓存 LCP ≤ 2.2s。
- [ ] 图片显示过程中没有明显闪白或布局跳动。
- [ ] CLS 继续保持 ≤ 0.1。

## 7. P0：恢复图片尺寸与格式优化

相关代码：

- [`next.config.js`](next.config.js)
- [`src/components/HeroBanner.tsx`](src/components/HeroBanner.tsx)
- [`src/components/CardPoster.tsx`](src/components/CardPoster.tsx)
- [`src/components/ShortDramaCard.tsx`](src/components/ShortDramaCard.tsx)
- [`src/app/api/image-proxy/route.ts`](src/app/api/image-proxy/route.ts)
- [`src/lib/image-url.ts`](src/lib/image-url.ts)

当前问题：

- `images.unoptimized: true` 全局关闭 Next.js 图片优化。
- `quality={75}` 和 `quality={80}` 不能生成实际压缩变体。
- 代理缓存以 `original` 为主，浏览器获得的是源站原图。
- 小尺寸卡片可能下载数百 KB，甚至 1.49MB。
- Hero 在没有横向背景图时把竖版海报升级成大尺寸并全屏裁剪。
- 动态轮播会预加载多张大图。

技术方案需要在以下选项中择一：

1. 恢复 Next.js 默认 `/_next/image` 优化；
2. 为现有安全图片代理增加尺寸/格式转换；
3. 使用 Cloudflare Image Resizing 或独立图片 CDN。

无论选择哪种实现，都必须保留现有的上游 URL 安全校验和内容类型校验。

实施清单：

- [ ] 确认生产运行环境是否具备 Next.js 图片优化所需依赖和持久化策略。
- [ ] 评估移除 `images.unoptimized: true`。
- [ ] 若继续使用代理，新增 `w`、`h`、`fit`、`format`、`quality` 参数。
- [ ] 把尺寸和格式参数纳入缓存键，避免不同变体互相覆盖。
- [ ] 限制允许的宽高档位，避免任意参数造成缓存爆炸或资源消耗攻击。
- [ ] 优先输出 AVIF/WebP，并根据 `Accept` 协商格式。
- [ ] 卡片提供约 180、270、360、540px 等固定宽度档位。
- [ ] Hero 提供适合常用视口宽度的响应式档位。
- [ ] Hero 优先使用真实横向 `backdrop`。
- [ ] 没有横向图时，考虑服务端生成裁剪后的横向变体，而不是直接拉伸竖版海报。
- [ ] 禁止默认把 `s_ratio_poster` 无条件替换为 `l_ratio_poster`。
- [ ] 保留 ETag、Last-Modified 和条件请求支持。
- [ ] 检查图片代理缓存未命中时是否可以边传输边缓存，避免完整读取上游后才响应。
- [ ] 给图片变体增加最大像素数和最大编码体积限制。

建议体积预算：

- [ ] 普通卡片 1x 图片 ≤ 30KB。
- [ ] 普通卡片 2x 图片 ≤ 60KB。
- [ ] Hero 移动端图片 ≤ 100KB。
- [ ] Hero 桌面图片一般控制在 150～250KB，具体根据画质测试确定。
- [ ] 禁止 1MB 以上图片作为首页高优先级资源。

验收方法：

- [ ] 检查图片请求 URL 是否包含明确尺寸或优化参数。
- [ ] 检查响应 `Content-Type` 是否优先为 AVIF/WebP。
- [ ] 检查卡片资源的自然尺寸与实际显示尺寸是否处于合理比例。
- [ ] 首屏只下载实际显示需要的图片变体。
- [ ] 同一图片不同尺寸正确命中独立缓存。
- [ ] 使用慢速网络复测，确保图片不会持续加载到 20～40 秒。

## 8. P1：收紧首屏图片优先级

相关代码：

- [`src/components/ContinueWatching.tsx`](src/components/ContinueWatching.tsx)
- [`src/components/CardPoster.tsx`](src/components/CardPoster.tsx)
- [`src/components/HeroBanner.tsx`](src/components/HeroBanner.tsx)

当前问题：

- “继续观看”前 6 张图片均设置为 `priority`。
- `CardPoster` 会把 `priority` 转为 `loading='eager'` 和 `fetchPriority='high'`。
- Hero 自身已经需要加载高优先级 LCP 图片。
- 当前、上一张和下一张 Hero 同时挂载，轮播切换后还会继续产生 preload。

实施清单：

- [ ] 删除 `ContinueWatching` 中 `priority={index < 6}`。
- [ ] “继续观看”默认全部使用 `loading='lazy'` 和自动优先级。
- [ ] 如需提升即将进入视口的图片，只提升第一张且由 IntersectionObserver 决定。
- [ ] Hero 只允许当前第一张图片使用 preload/high priority。
- [ ] 上一张轮播图在离开后卸载，或确保不会继续占用加载优先级。
- [ ] 下一张轮播图改为浏览器空闲后低优先级预取。
- [ ] 轮播切换时不要为每一张新当前图片持续向 `<head>` 累积 preload。
- [ ] 检查 Next.js 生成的 `<link rel='preload' as='image'>` 数量。

验收方法：

- [ ] 初次打开首页时，高优先级图片总数为 1。
- [ ] `<head>` 中 Hero 图片 preload 总数为 1。
- [ ] “继续观看”图片不会在 Hero LCP 完成前抢占高优先级。
- [ ] 轮播运行 60 秒后，preload 标签不会持续增长。

## 9. P1：把 Hero 视频移出 LCP 关键路径

相关代码：

- [`src/app/page.tsx`](src/app/page.tsx)
- [`src/components/HeroBanner.tsx`](src/components/HeroBanner.tsx)
- [`src/app/api/video-proxy/route.ts`](src/app/api/video-proxy/route.ts)
- [`src/lib/douban-api.ts`](src/lib/douban-api.ts)

当前问题：

- 首页始终传入 `enableVideo={true}`。
- 普通网络下，Hero 挂载后约 2.5 秒开始请求视频。
- 视频失败时最多重试 4 次，每次间隔 5 秒。
- 实测视频代理存在 404、500 和浏览器中止请求。
- 404 后继续重试对用户体验没有收益，还增加源站和上游解析负担。

实施清单：

- [ ] 默认不在首屏加载阶段创建 `<video>`。
- [ ] 视频至少延迟到 LCP 完成后再加载。
- [ ] 优先采用用户 hover、点击或显式播放作为加载触发条件。
- [ ] `saveData`、2G、3G、高 RTT 或低带宽场景完全禁用自动视频。
- [ ] 在 Hero 数据中增加 `trailerAvailable` 字段。
- [ ] 已知无预告片时禁止请求 `/api/video-proxy`。
- [ ] 404/403 立即停止当前影片的客户端重试。
- [ ] 对无预告片结果设置明确负缓存 TTL。
- [ ] 对 5xx 使用有限次数、带抖动的重试；默认不超过 1 次。
- [ ] 轮播切换时立即取消上一张视频的未完成请求和重试计时器。
- [ ] 检查视频代理是否正确支持 Range，避免无意下载完整视频。

验收方法：

- [ ] LCP 之前没有 `/api/video-proxy` 请求。
- [ ] 无预告片影片只出现一次 404，或完全不发出请求。
- [ ] 轮播自动运行时不产生连续 404/500 风暴。
- [ ] 关闭自动视频后，Hero 图片和文本展示功能保持完整。

## 10. P1：优化亚洲用户的部署和 CDN 路由

当前问题：

- 测试请求命中 Cloudflare 美国圣何塞 `SJC`。
- 静态资源已经是边缘缓存 `HIT`，但 TTFB 仍约 0.6～0.8 秒。
- 当前首屏有较多并发资源，跨洋低吞吐会把小体积问题放大成数秒等待。

实施清单：

- [ ] 通过真实用户数据确认主要用户地区和运营商分布。
- [ ] 连续记录 Cloudflare `CF-Ray` 机房后缀和 TTFB。
- [ ] 对中国大陆、香港、日本、新加坡分别执行探测。
- [ ] 评估将 Node.js 应用部署到香港、日本或新加坡区域。
- [ ] 评估面向中国大陆线路优化且满足合规要求的 CDN。
- [ ] 确认静态 `_next/static` 资源继续使用长缓存和 immutable。
- [ ] 确认图片变体也可在边缘长期缓存。
- [ ] 动态、鉴权和用户私有响应继续禁止共享缓存。
- [ ] 检查 Brotli 是否对支持的浏览器启用。
- [ ] 变更线路前后分别比较 TTFB、下载吞吐和丢包，不只比较 Lighthouse 总分。

验收方法：

- [ ] 亚洲主要地区 p75 TTFB ≤ 800ms。
- [ ] 目标区域静态资源 TTFB 尽量控制在 300ms 内。
- [ ] 静态资源保持 `CF-Cache-Status: HIT`。
- [ ] CDN 调整没有错误缓存用户私有 RSC/API 响应。

## 11. P2：控制 JavaScript、CSS 和主线程开销

相关代码：

- [`src/app/page.tsx`](src/app/page.tsx)
- [`src/components/home/HomeRecommendationSections.tsx`](src/components/home/HomeRecommendationSections.tsx)
- [`src/components/DeferredSection.tsx`](src/components/DeferredSection.tsx)
- [`src/app/globals.css`](src/app/globals.css)
- [`package.json`](package.json)

当前问题：

- 初始 JavaScript 约 778KB 解压。
- 主 CSS 约 374KB 解压并位于 FCP 关键路径。
- 暖缓存仍捕获到一个 643ms 长任务。
- RSC 路由预取会附带加载更多路由 chunk，放大执行和解析成本。
- `DeferredSection` 默认使用 `500px` root margin，部分非首屏区域可能过早挂载。

实施清单：

- [ ] 先完成 RSC 预取治理，再重新记录首页实际初始 chunk 数量。
- [ ] 接入 Next.js bundle analyzer，生成构建体积报告。
- [ ] 使用 Chrome Coverage 确认首屏未使用的 JavaScript 和 CSS。
- [ ] 不基于依赖名称猜测，只有确认未使用后才删除或延迟加载。
- [ ] 检查客户端边界是否把不需要交互的展示组件一并打入客户端包。
- [ ] 将推荐展示尽可能保留为 Server Component。
- [ ] 检查动态加载的 `VideoCard` 是否在首屏被过早触发。
- [ ] 调整 `DeferredSection` 的 `rootMargin`，避免 500px 预挂载过多推荐区。
- [ ] 为首屏关键 CSS 和非关键 CSS 建立体积预算。
- [ ] 检查 Tailwind 构建是否包含不必要的动态类安全列表或重复样式。
- [ ] 通过 Performance trace 定位 643ms 长任务的调用栈。
- [ ] 将昂贵的本地数据整理、排序或状态初始化移出首屏主任务。
- [ ] 检查开发调试日志是否进入生产构建。

验收方法：

- [ ] 生产首页初始 JavaScript 压缩体积明显下降，并记录变更前后数据。
- [ ] 首屏不存在超过 200ms 的主线程任务。
- [ ] 非首屏推荐区 chunk 不在首次视口静止时下载。
- [ ] CSS 优化后 FCP 不再等待大型样式文件完成。
- [ ] 所有拆包都通过低端移动设备回归，避免过度拆包导致请求数反向增长。

## 12. P2：继续观看和更新检查延后执行

相关代码：

- [`src/components/ContinueWatching.tsx`](src/components/ContinueWatching.tsx)
- [`src/lib/watching-updates.ts`](src/lib/watching-updates.ts)

当前问题：

- 播放记录加载后可能立即执行 watching updates 检查。
- 缓存为空时会继续请求数据源和多个详情接口。
- 实测在首页加载尾部出现 `/api/sources` 和多个 `/api/detail` 请求。

实施清单：

- [ ] 继续观看基础列表优先从现有查询缓存显示。
- [ ] 更新检查延迟到 LCP 完成后或浏览器空闲时执行。
- [ ] 为更新检查设置合理缓存 TTL，避免每次首页访问都检查。
- [ ] 页面不可见时暂停更新检查。
- [ ] 多个记录的详情检查使用批量或并发上限。
- [ ] 确保 `getAllPlayRecords` 在同一页面生命周期内不会重复请求。
- [ ] 更新检查失败只记录一次，不进行密集重试。

验收方法：

- [ ] LCP 前只允许一次播放记录基础请求。
- [ ] `/api/sources` 和 `/api/detail` 不进入首屏关键路径。
- [ ] 继续观看内容仍能快速显示，更新徽章可以延迟出现。

## 13. 性能监控与防回归

实施清单：

- [ ] 安装并初始化 `web-vitals` 上报。
- [ ] 上报 LCP、INP、CLS、TTFB、FCP 和页面路径。
- [ ] 同时记录设备类型、网络类型、国家/地区和发布版本。
- [ ] 不上报用户隐私数据、完整查询参数或播放记录内容。
- [ ] 为 LCP 记录元素类型和经过脱敏的组件标识。
- [ ] 在 CI 中增加生产构建体积检查。
- [ ] 为首页关键资源设置体积预算。
- [ ] 在 PR 中保存冷加载和暖加载对比数据。
- [ ] UI 改动附首屏截图和 Performance trace 摘要。
- [ ] 建立性能回退阈值，超过阈值时阻止发布或发出警告。

建议持续监控的预算：

| 项目               | 警告阈值 | 阻断阈值 |
| ------------------ | -------: | -------: |
| 首页初始压缩 JS    |    250KB |    350KB |
| 首屏阻塞 CSS       |     50KB |     75KB |
| 单张卡片图片       |     80KB |    150KB |
| 单张 Hero 图片     |    250KB |    400KB |
| 首页自动 RSC 预取  |     3 个 |     8 个 |
| LCP 前高优先级图片 |     1 张 |     2 张 |
| 主线程单任务       |    200ms |    500ms |

## 14. 推荐拆分顺序

为了便于验证收益并降低一次性改动风险，建议按以下顺序拆分：

### 第一批：低风险、立即收益

- [ ] 修复 `FastLink` 的预取默认值。
- [ ] 关闭 Hero 和推荐区不必要的 Link 预取。
- [ ] 删除继续观看前 6 张图片的高优先级。
- [ ] 让第一张 Hero 图片立即可见。
- [ ] 禁止 LCP 前自动加载视频。

验收重点：RSC 请求数、暖缓存 LCP、高优先级图片数、视频请求数。

### 第二批：图片链路

- [ ] 确定 Next 图片优化或代理变体方案。
- [ ] 实现卡片和 Hero 响应式图片。
- [ ] 调整 Hero backdrop 策略。
- [ ] 完成图片缓存和安全回归测试。

验收重点：图片实际传输体积、LCP、代理缓存命中、安全限制。

### 第三批：首页数据架构

- [ ] 拆分 Server Component 与客户端岛。
- [ ] 服务端输出首屏 Hero 和公共推荐数据。
- [ ] 删除 6 个客户端详情请求。
- [ ] 调整 React Query 刷新策略。

验收重点：冷加载 LCP、API 起始时间、Hero 内容稳定时间、错误降级。

### 第四批：基础设施与深度优化

- [ ] 优化亚洲部署/CDN 路由。
- [ ] 完成 bundle/CSS Coverage 分析。
- [ ] 定位并拆解长任务。
- [ ] 接入真实用户性能监控和 CI 预算。

验收重点：地区 p75 数据、构建体积、INP 和长期性能稳定性。

## 15. 每次优化后的统一复测流程

1. 使用生产构建，不以开发模式数据作为最终结论。
2. 使用干净 Chrome 配置，禁用与页面无关的扩展和用户脚本。
3. 固定桌面和移动端视口各测试一次。
4. 分别执行冷加载和暖缓存重载。
5. 每种场景至少执行 5 次，报告中位数和最差值。
6. 记录 TTFB、FCP、LCP、CLS、长任务、总请求数和传输体积。
7. 单独统计：
   - `_rsc=` 请求数量；
   - Hero 详情请求数量；
   - 图片 preload 数量；
   - 高优先级图片数量；
   - LCP 前视频请求数量；
   - 失败和重试请求数量。
8. 对比 LCP 资源的 `loadTime` 与 `renderTime`。
9. 检查首页静止 15 秒后是否仍有非必要网络活动。
10. 回归登录、继续观看、收藏、轮播、视频播放和各推荐区导航。

## 16. 完成定义

只有同时满足以下条件，首页性能优化任务才能标记为完成：

- [ ] 所有 P0 项目已经完成并通过各自验收。
- [ ] 冷加载 LCP 至少降至 4 秒以内，并有达到 2.5 秒的明确后续计划。
- [ ] 暖缓存 LCP 稳定低于 2.2 秒。
- [ ] 首页静止状态不再自动发出大量 RSC 请求。
- [ ] 首屏不存在超大、高优先级卡片图片。
- [ ] LCP 前不存在轮播视频请求和失败重试。
- [ ] CLS 没有回退。
- [ ] 生产构建、类型检查、Lint 和相关测试通过。
- [ ] 已记录变更前后性能数据。
- [ ] 已开始收集真实用户 Web Vitals，或已创建明确的监控落地任务。
