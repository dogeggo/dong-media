# 缓存部署与运维

Dong Media 的业务缓存以 `src/lib/cache-system/policies.ts` 为唯一策略来源。调用点不得自行覆盖业务 TTL、缓存 scope 或 Redis key 前缀。缓存 key 使用 `dm:v2:<environment>:<namespace>:p<version>:g<generation>:<scope-hash>:<params-hash>`；限流使用独立的 `dm:rate-limit:*` 空间，不受后台“清理缓存”影响。

## Docker 媒体缓存

图片和静态视频成功响应固定缓存一周（`604800` 秒）。磁盘对象也在一周后过期，并在达到容量高水位时按最近最少使用顺序清理到 80%。建议为图片和视频缓存目录挂载持久卷：

```yaml
services:
  lunatv:
    environment:
      MEDIA_CACHE_DIR: /app/cache
      IMAGE_CACHE_MAX_BYTES: 536870912
      IMAGE_CACHE_MAX_ENTRY_BYTES: 20971520
      VIDEO_CACHE_MAX_BYTES: 2147483648
      VIDEO_CACHE_MAX_ENTRY_BYTES: 104857600
    volumes:
      - /srv/dong-media/cache/image:/app/cache/image
      - /srv/dong-media/cache/video:/app/cache/video
```

可用参数：

| 参数                          |       默认值 | 说明                               |
| ----------------------------- | -----------: | ---------------------------------- |
| `MEDIA_CACHE_DIR`             | `/app/cache` | 媒体缓存根目录                     |
| `IMAGE_CACHE_MAX_BYTES`       |  `536870912` | 图片目录容量高水位（512 MiB）      |
| `IMAGE_CACHE_MAX_ENTRY_BYTES` |   `20971520` | 单张图片上限（20 MiB）             |
| `VIDEO_CACHE_MAX_BYTES`       | `2147483648` | 视频目录容量高水位（2 GiB）        |
| `VIDEO_CACHE_MAX_ENTRY_BYTES` |  `104857600` | 单个落盘视频上限（100 MiB）        |
| `DISABLE_DISK_CACHE`          |      `false` | 设为 `true` 时旁路磁盘层           |
| `CACHE_ENVIRONMENT`           |   `NODE_ENV` | 多环境共用 Redis 时的 key 隔离名称 |

Vercel 环境自动旁路磁盘层。目录不可写时也会 fail-open 为纯代理，不会让媒体请求因缓存故障失败。带 token、signature、expires 等短时签名参数的源 URL 不进入共享 HTTP 或磁盘缓存。

## Redis/Kvrocks

Redis/Kvrocks 只保存可再生的业务缓存 envelope，并始终设置原生 TTL。namespace 清理使用 generation `INCR`，旧对象依靠 TTL 自然回收；统计使用 `SCAN`，请求路径和管理接口均不使用 `KEYS`。

共享缓存不可用时请求会回源并使用进程内有界 L1。恢复连接后 adapter 会重新发现客户端。不要把登录会话、限流计数或用户主数据当作普通业务缓存清理。

## Cloudflare Worker 与 R2

`scripts/worker.js` 只缓存明确 allowlist 中的静态图片、静态视频和代理成功响应。部署时绑定名为 `CACHE_BUCKET` 的 R2 Bucket，并配置至少 16 字符的 `CACHE_PURGE_TOKEN` secret：

```bash
wrangler secret put CACHE_PURGE_TOKEN
```

再为 Worker 配置定时触发器（建议每小时一次），使 `scheduled` handler 只扫描并删除 `media-v2/` 前缀下 `expiresAt` 已到期的 R2 对象，不影响同一 Bucket 中的其他数据。每个 R2 对象的到期时间不超过源站响应的实际剩余 TTL；如果平台支持 Bucket 生命周期规则，也应额外配置七天删除作为兜底。

Worker 默认旁路以下请求：Cookie、Authorization、Range、签名参数、动态 M3U8、非 allowlist 路径，以及源站返回 `private`、`no-store`、`Set-Cookie`、除 `Accept-Encoding` 外的 `Vary` 维度、错误状态或错误 Content-Type 的响应。可缓存请求统一向源站请求 `identity` 编码，保证 URL-only Edge/R2 key 不会混用不同表示。Edge 条目保存绝对到期时间，命中时按剩余时间重写 `max-age`/`s-maxage`，不会从每次命中时重新续期一周。受保护的单对象 purge 使用：

```bash
curl -X DELETE \
  -H "Authorization: Bearer $CACHE_PURGE_TOKEN" \
  'https://media.example.com/api/image-proxy?url=https%3A%2F%2Fexample.com%2Fposter.jpg'
```

## 管理与排障

站长可在管理页按 namespace 查看策略、层级、估算空间、命中率、错误数和合并回源次数。操作语义如下：

- “失效”切换所选 namespace 的 generation，并移除当前进程的对应 L1 条目。
- “清理过期项”清理过期 L1 以及过期、损坏、孤儿和旧临时媒体对象；Redis 由 TTL 自动物理清理。
- “清理全部缓存”切换全部业务 namespace generation，并清理 v2 图片/视频磁盘对象。
- 所有操作均不会删除用户偏好，也不会删除 localStorage 模式下的播放记录、收藏、搜索历史或跳过配置。

验证部署时应检查：

```bash
curl -I 'https://example.com/api/image-proxy?url=https%3A%2F%2Fimages.example.org%2Fposter.jpg'
curl -I -H 'Range: bytes=0-1023' 'https://example.com/api/video-proxy?url=https%3A%2F%2Fvideo.example.org%2Fdemo.mp4'
```

成功的无签名静态媒体应包含 `public, max-age=604800, s-maxage=604800`；固定 URL 不包含 `immutable`。错误、鉴权响应、短时签名媒体和动态播放清单必须是 `private, no-store, max-age=0`。
