export interface AdminConfig {
  ConfigSubscribtion: {
    URL: string;
    AutoUpdate: boolean;
    LastCheck: string;
  };
  ConfigFile: string;
  SiteConfig: {
    SiteName: string;
    Announcement: string;
    SearchDownstreamMaxPage: number;
    ShowAdultContent: boolean; // 是否显示成人内容，默认 false
    FluidSearch: boolean;
    // TMDB配置
    TMDBApiKey?: string;
    TMDBLanguage?: string;
    EnableTMDBActorSearch?: boolean;
    // 结构化去广告规则（禁止执行管理员提供的 JavaScript）
    AdFilterConfig?: {
      enabled: boolean;
      version: number;
      globalKeywords: string[];
      removeCueBlocks: boolean;
      removeDiscontinuity: boolean;
      sourceRules: {
        source: string;
        keywords: string[];
        durations: number[];
      }[];
    };
    // 默认用户组
    DefaultUserTags?: string[];
  };
  UserConfig: {
    AllowRegister?: boolean; // 是否允许用户注册，默认 true
    AutoCleanupInactiveUsers?: boolean; // 是否自动清理非活跃用户，默认 false
    InactiveUserDays?: number; // 非活跃用户保留天数，默认 7
    Users: {
      username: string;
      role: 'user' | 'admin' | 'owner';
      banned?: boolean;
      enabledApis?: string[]; // 优先级高于tags限制（网站内搜索用）
      tags?: string[]; // 多 tags 取并集限制
      createdAt?: number; // 用户注册时间戳
      tvboxToken?: string; // 用户专属的 TVBox Token
      tvboxEnabledSources?: string[]; // TVBox 可访问的源（为空则返回所有源）
      oidcSub?: string; // OIDC的唯一标识符(sub字段)
    }[];
    Tags?: {
      name: string;
      enabledApis: string[];
      showAdultContent?: boolean; // 用户组级别的成人内容显示控制
    }[];
  };
  SourceConfig: {
    key: string;
    name: string;
    api: string;
    detail?: string;
    from: 'config' | 'custom';
    disabled?: boolean;
    is_adult?: boolean;
  }[];
  CustomCategories: {
    name?: string;
    type: 'movie' | 'tv';
    query: string;
    from: 'config' | 'custom';
    disabled?: boolean;
  }[];
  LiveConfig?: {
    key: string;
    name: string;
    url: string; // m3u 地址
    ua?: string;
    epg?: string; // 节目单
    isTvBox?: boolean;
    from: 'config' | 'custom';
    channelNumber?: number;
    disabled?: boolean;
  }[];
  NetDiskConfig?: {
    enabled: boolean; // 是否启用网盘搜索
    pansouUrl: string; // PanSou服务地址
    timeout: number; // 请求超时时间(秒)
    enabledCloudTypes: string[]; // 启用的网盘类型
  };

  YouTubeConfig?: {
    enabled: boolean; // 是否启用YouTube搜索功能
    apiKey: string; // YouTube Data API v3密钥
    enableDemo: boolean; // 是否启用演示模式
    maxResults: number; // 每页最大搜索结果数
    enabledRegions: string[]; // 启用的地区代码列表
    enabledCategories: string[]; // 启用的视频分类列表
  };
  TVBoxSecurityConfig?: {
    enableAuth: boolean; // 是否启用Token验证
    token: string; // 访问Token
    enableIpWhitelist: boolean; // 是否启用IP白名单
    allowedIPs: string[]; // 允许的IP地址列表
    enableRateLimit: boolean; // 是否启用频率限制
    rateLimit: number; // 每分钟允许的请求次数
  };
  TVBoxProxyConfig?: {
    enabled: boolean; // 是否为TVBox启用Cloudflare Worker代理
    proxyUrl: string; // Cloudflare Worker代理地址（例如：https://corsapi.smone.workers.dev）
  };
  VideoProxyConfig?: {
    enabled: boolean; // 是否为普通视频源启用Cloudflare Worker代理
    proxyUrl: string; // Cloudflare Worker代理地址（例如：https://corsapi.smone.workers.dev）
  };
  // 新的多 Provider 配置
  OIDCProviders?: {
    id: string; // Provider ID (google, github, microsoft, linuxdo, custom)
    name: string; // 显示名称
    enabled: boolean; // 是否启用此Provider
    enableRegistration: boolean; // 是否启用注册
    issuer: string; // OIDC Issuer URL
    authorizationEndpoint: string; // 授权端点
    tokenEndpoint: string; // Token端点
    userInfoEndpoint: string; // 用户信息端点
    clientId: string; // Client ID
    clientSecret: string; // Client Secret
    buttonText: string; // 按钮文字
    minTrustLevel: number; // 最低信任等级
  }[];
  ShortDramaConfig?: {
    primaryApiUrl: string; // 主API地址
  };
  DownloadConfig?: {
    enabled: boolean; // 是否启用下载功能（全局开关）
  };
}

export interface AdminConfigResult {
  Role: 'owner' | 'admin';
  Config: AdminConfig;
}
