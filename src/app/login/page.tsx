'use client';

import { AlertCircle, Lock, Sparkles, User, UserPlus } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';

import { processImageUrl } from '@/lib/image-url';
import {
  normalizeLoginRedirect,
  sanitizeInternalRedirect,
} from '@/lib/safe-redirect';

import {
  detectProvider,
  getProviderButtonStyle,
  getProviderButtonText,
  OIDCProviderLogo,
} from '@/components/OIDCProviderLogos';
import { useSite } from '@/components/SiteProvider';
import { ThemeToggle } from '@/components/ThemeToggle';

function LoginPageClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [shouldAskUsername, setShouldAskUsername] = useState(false);
  const [bingWallpaper, setBingWallpaper] = useState<string>('');
  const [siteHost, setSiteHost] = useState('');

  // OIDC 登录状态
  const [oidcProviders, setOidcProviders] = useState<
    Array<{
      id: string;
      name: string;
      buttonText: string;
      issuer: string;
    }>
  >([]);
  const [oidcEnabled, setOidcEnabled] = useState(false);

  const { siteName } = useSite();

  // 获取 Bing 每日壁纸（通过代理 API）
  useEffect(() => {
    const fetchBingWallpaper = async () => {
      try {
        const response = await fetch('/api/bing-wallpaper');
        const data = await response.json();
        if (data.url) {
          setBingWallpaper(processImageUrl(data.url));
        }
      } catch (error) {
        console.log('Failed to fetch Bing wallpaper:', error);
      }
    };

    fetchBingWallpaper();
  }, []);

  // 在客户端挂载后设置配置
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const storageType = (window as any).RUNTIME_CONFIG?.STORAGE_TYPE;
      setShouldAskUsername(storageType && storageType !== 'localstorage');
      setSiteHost(window.location.host);
    }
  }, []);

  // 获取 OIDC 登录配置
  useEffect(() => {
    const fetchLoginConfig = async () => {
      try {
        const response = await fetch('/api/server-config');
        const data = await response.json();
        if (data.OIDCProviders && data.OIDCProviders.length > 0) {
          console.log('[Login] Multiple OIDC providers enabled!');
          setOidcProviders(data.OIDCProviders);
          setOidcEnabled(true);
        }
      } catch (error) {
        console.log('Failed to fetch server config:', error);
      }
    };

    fetchLoginConfig();
  }, []);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);

    if (!password || (shouldAskUsername && !username)) return;

    try {
      setLoading(true);
      const requestedRedirect = normalizeLoginRedirect(
        searchParams.get('redirect'),
        searchParams,
      );
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          password,
          ...(shouldAskUsername ? { username } : {}),
          ...(requestedRedirect !== '/' ? { redirect: requestedRedirect } : {}),
        }),
      });

      if (res.ok) {
        const data = await res.json().catch(() => ({}));
        // 记录登入时间
        const loginTime = Date.now();
        try {
          await fetch('/api/user/my-stats', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ loginTime }),
          });
        } catch (error) {
          console.log('记录登入时间失败:', error);
          // 登入时间记录失败不影响正常登录流程
        }
        router.replace(sanitizeInternalRedirect(data.redirect));
      } else if (res.status === 401) {
        setError('密码错误');
        setLoading(false);
      } else {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? '服务器错误');
        setLoading(false);
      }
    } catch (_error) {
      setError('网络错误，请稍后重试');
      setLoading(false);
    }
  };

  return (
    <div className='relative min-h-screen flex items-center justify-center px-3 sm:px-4 py-8 sm:py-0 overflow-hidden'>
      {/* Bing 每日壁纸背景 */}
      {bingWallpaper && (
        <div
          className='absolute inset-0 bg-cover bg-center bg-no-repeat transition-opacity duration-1000 animate-ken-burns'
          style={{ backgroundImage: `url(${bingWallpaper})` }}
        />
      )}

      {/* 渐变叠加层 */}
      <div className='absolute inset-0 bg-linear-to-br from-purple-600/40 via-primary-600/30 to-pink-500/40 dark:from-purple-900/50 dark:via-primary-900/40 dark:to-pink-900/50' />
      <div className='absolute inset-0 bg-linear-to-t from-black/50 via-transparent to-black/30' />

      <div className='absolute top-3 right-3 sm:top-4 sm:right-4 z-20'>
        <ThemeToggle />
      </div>
      <div
        className='relative z-10 w-full max-w-md rounded-2xl sm:rounded-3xl bg-linear-to-br from-white/95 via-white/85 to-white/75 dark:from-zinc-900/95 dark:via-zinc-900/85 dark:to-zinc-900/75 backdrop-blur-2xl shadow-[0_20px_80px_rgba(0,0,0,0.3)] dark:shadow-[0_20px_80px_rgba(0,0,0,0.6)] p-6 sm:p-10 border border-white/50 dark:border-zinc-700/50 animate-fade-in hover:shadow-[0_25px_100px_rgba(0,0,0,0.4)] transition-shadow duration-500'
        style={{
          backgroundColor: 'rgba(255, 255, 255, 0.95)',
        }}
      >
        {/* Fallback for browsers without backdrop-filter support */}
        <style jsx>{`
          @supports (backdrop-filter: blur(24px)) or
            (-webkit-backdrop-filter: blur(24px)) {
            div {
              background-color: transparent !important;
            }
          }
        `}</style>
        {/* 装饰性光效 */}
        <div className='absolute -top-20 -left-20 w-40 h-40 bg-linear-to-br from-purple-400/30 to-pink-400/30 rounded-full blur-3xl animate-pulse' />
        <div
          className='absolute -bottom-20 -right-20 w-40 h-40 bg-linear-to-br from-primary-400/30 to-cyan-400/30 rounded-full blur-3xl animate-pulse'
          style={{ animationDelay: '1s' }}
        />

        {/* 标题区域 */}
        <div className='text-center mb-6 sm:mb-8'>
          <div className='inline-flex items-center justify-center w-12 h-12 sm:w-16 sm:h-16 mb-3 sm:mb-4 rounded-xl sm:rounded-2xl bg-linear-to-br from-primary-500 to-emerald-600 shadow-lg shadow-primary-500/50 dark:shadow-primary-500/30'>
            <Sparkles className='w-6 h-6 sm:w-8 sm:h-8 text-white' />
          </div>
          <h1 className='text-transparent bg-clip-text bg-linear-to-r from-primary-600 via-emerald-600 to-teal-600 dark:from-primary-400 dark:via-emerald-400 dark:to-teal-400 tracking-tight text-3xl sm:text-4xl font-extrabold mb-2 drop-shadow-sm'>
            {siteName}
          </h1>
          <p className='text-gray-600 dark:text-gray-400 text-xs sm:text-sm font-medium'>
            欢迎回来，请登录您的账户
          </p>
        </div>

        <form onSubmit={handleSubmit} className='space-y-4 sm:space-y-6'>
          {shouldAskUsername && (
            <div className='group'>
              <label
                htmlFor='username'
                className='block text-xs sm:text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5 sm:mb-2'
              >
                用户名
              </label>
              <div className='relative'>
                <div className='absolute inset-y-0 left-0 pl-3 sm:pl-4 flex items-center pointer-events-none'>
                  <User className='h-4 w-4 sm:h-5 sm:w-5 text-gray-400 dark:text-gray-500 group-focus-within:text-primary-500 transition-colors' />
                </div>
                <input
                  id='username'
                  type='text'
                  autoComplete='username'
                  className='block w-full pl-10 sm:pl-12 pr-3 sm:pr-4 py-2.5 sm:py-3.5 rounded-lg sm:rounded-xl border-0 text-gray-900 dark:text-gray-100 shadow-sm ring-2 ring-white/60 dark:ring-white/10 placeholder:text-gray-400 dark:placeholder:text-gray-500 focus:ring-2 focus:ring-primary-500 dark:focus:ring-primary-400 focus:outline-none text-sm sm:text-base bg-white/80 dark:bg-zinc-800/80 backdrop-blur transition-all duration-300 hover:shadow-md'
                  placeholder='请输入用户名'
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                />
              </div>
            </div>
          )}

          <div className='group'>
            <label
              htmlFor='password'
              className='block text-xs sm:text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5 sm:mb-2'
            >
              密码
            </label>
            <div className='relative'>
              <div className='absolute inset-y-0 left-0 pl-3 sm:pl-4 flex items-center pointer-events-none'>
                <Lock className='h-4 w-4 sm:h-5 sm:w-5 text-gray-400 dark:text-gray-500 group-focus-within:text-primary-500 transition-colors' />
              </div>
              <input
                id='password'
                type='password'
                autoComplete='current-password'
                className='block w-full pl-10 sm:pl-12 pr-3 sm:pr-4 py-2.5 sm:py-3.5 rounded-lg sm:rounded-xl border-0 text-gray-900 dark:text-gray-100 shadow-sm ring-2 ring-white/60 dark:ring-white/10 placeholder:text-gray-400 dark:placeholder:text-gray-500 focus:ring-2 focus:ring-primary-500 dark:focus:ring-primary-400 focus:outline-none text-sm sm:text-base bg-white/80 dark:bg-zinc-800/80 backdrop-blur transition-all duration-300 hover:shadow-md'
                placeholder='请输入访问密码'
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
          </div>

          {error && (
            <div className='flex items-center gap-2 p-2.5 sm:p-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800/50 animate-slide-down'>
              <AlertCircle className='h-4 w-4 text-red-600 dark:text-red-400 shrink-0' />
              <p className='text-xs sm:text-sm text-red-600 dark:text-red-400'>
                {error}
              </p>
            </div>
          )}

          {/* 登录按钮 */}
          <button
            type='submit'
            disabled={!password || loading || (shouldAskUsername && !username)}
            className='group relative inline-flex w-full justify-center items-center gap-1.5 sm:gap-2 rounded-lg sm:rounded-xl bg-linear-to-r from-primary-600 to-emerald-600 hover:from-primary-700 hover:to-emerald-700 py-2.5 sm:py-3.5 text-sm sm:text-base font-semibold text-white shadow-lg shadow-primary-500/30 transition-all duration-300 hover:shadow-xl hover:shadow-primary-500/40 hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0 disabled:hover:shadow-lg overflow-hidden active:scale-95'
          >
            <span className='absolute inset-0 w-full h-full bg-linear-to-r from-white/0 via-white/20 to-white/0 -translate-x-full group-hover:translate-x-full transition-transform duration-1000' />
            <Lock className='h-4 w-4 sm:h-5 sm:w-5' />
            {loading ? '登录中...' : '立即登录'}
          </button>

          {/* 注册链接 - 仅在非 localStorage 模式下显示 */}
          {shouldAskUsername && (
            <div className='mt-4 sm:mt-6 pt-4 sm:pt-6 border-t border-gray-200 dark:border-gray-700'>
              <p className='text-center text-gray-600 dark:text-gray-400 text-xs sm:text-sm mb-2.5 sm:mb-3'>
                还没有账户？
              </p>
              <a
                href='/register'
                className='group flex items-center justify-center gap-1.5 sm:gap-2 w-full px-4 sm:px-6 py-2 sm:py-2.5 rounded-lg bg-linear-to-r from-primary-50 to-emerald-50 dark:from-primary-900/20 dark:to-emerald-900/20 border border-primary-200 dark:border-primary-800/50 text-primary-700 dark:text-primary-400 text-xs sm:text-sm font-semibold hover:from-primary-100 hover:to-emerald-100 dark:hover:from-primary-900/30 dark:hover:to-emerald-900/30 hover:border-primary-300 dark:hover:border-primary-700 transition-all duration-300 hover:shadow-md hover:scale-[1.02] active:scale-100'
              >
                <UserPlus className='w-3.5 h-3.5 sm:w-4 sm:h-4' />
                <span>立即注册</span>
                <span className='inline-block transition-transform group-hover:translate-x-1'>
                  →
                </span>
              </a>
            </div>
          )}
        </form>

        {/* OIDC 登录 */}
        {oidcEnabled && shouldAskUsername && (
          <div className='mt-4 sm:mt-6 pt-4 sm:pt-6 border-t border-gray-200 dark:border-gray-700'>
            <div className='relative'>
              <div className='absolute inset-0 flex items-center'>
                <div className='w-full border-t border-gray-300 dark:border-gray-600'></div>
              </div>
              <div className='relative flex justify-center text-xs sm:text-sm'>
                <span className='px-2 bg-white/60 dark:bg-zinc-900/60 text-gray-500 dark:text-gray-400'>
                  或
                </span>
              </div>
            </div>

            {/* 多 Provider 按钮 */}
            {oidcProviders.length > 0 && (
              <div className='mt-3 sm:mt-4 space-y-2.5 sm:space-y-3'>
                {oidcProviders.map((provider) => {
                  // 优先使用 provider.id，如果是自定义provider则从issuer推断
                  const providerId = provider.id.toLowerCase();
                  const detectedProvider = [
                    'google',
                    'github',
                    'microsoft',
                    'facebook',
                    'wechat',
                    'apple',
                    'linuxdo',
                  ].includes(providerId)
                    ? (providerId as
                        | 'google'
                        | 'github'
                        | 'microsoft'
                        | 'facebook'
                        | 'wechat'
                        | 'apple'
                        | 'linuxdo')
                    : detectProvider(provider.issuer || provider.buttonText);
                  const buttonStyle = getProviderButtonStyle(detectedProvider);
                  const customText =
                    provider.buttonText &&
                    provider.buttonText !== '使用OIDC登录'
                      ? provider.buttonText
                      : undefined;
                  const buttonText = getProviderButtonText(
                    detectedProvider,
                    customText,
                  );

                  return (
                    <button
                      key={provider.id}
                      type='button'
                      onClick={() =>
                        (window.location.href = `/api/auth/oidc/login?provider=${provider.id}`)
                      }
                      className={`w-full inline-flex justify-center items-center rounded-lg py-2.5 sm:py-3 text-sm sm:text-base font-semibold shadow-sm transition-all duration-200 active:scale-95 ${buttonStyle}`}
                    >
                      <OIDCProviderLogo provider={detectedProvider} />
                      <span className='ml-2'>{buttonText}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <LoginPageClient />
    </Suspense>
  );
}
