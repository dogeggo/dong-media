'use client';

import { Copy, Key, Settings, X } from 'lucide-react';
import { useState } from 'react';

interface TVBoxTokenManagerProps {
  username: string;
  tvboxToken?: string;
  onUpdate: () => void;
}

export function TVBoxTokenCell({ tvboxToken }: { tvboxToken?: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    if (tvboxToken) {
      await navigator.clipboard.writeText(tvboxToken);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  if (!tvboxToken) {
    return (
      <span className='text-xs text-gray-400 dark:text-gray-500'>未设置</span>
    );
  }

  return (
    <div className='flex items-center space-x-2'>
      <span className='text-xs font-mono text-gray-600 dark:text-gray-400'>
        {tvboxToken.substring(0, 8)}...
      </span>
      <button
        onClick={handleCopy}
        className='p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded'
        title='复制完整Token'
      >
        <Copy
          className={`w-3 h-3 ${copied ? 'text-primary-600' : 'text-gray-400'}`}
        />
      </button>
    </div>
  );
}

export function TVBoxTokenModal({
  username,
  tvboxToken,
  onClose,
  onUpdate,
}: TVBoxTokenManagerProps & { onClose: () => void }) {
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);

  const handleRegenerate = async () => {
    setIsSaving(true);
    setMessage(null);

    try {
      const response = await fetch('/api/admin/user-tvbox-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username,
          regenerateToken: true,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || '保存失败');
      }

      setMessage({
        type: 'success',
        text: tvboxToken ? 'Token已重新生成' : 'Token已生成',
      });
      setTimeout(() => {
        onUpdate();
        onClose();
      }, 1500);
    } catch (error: any) {
      setMessage({ type: 'error', text: error.message || '保存失败' });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className='fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4'>
      <div className='bg-white dark:bg-gray-800 rounded-lg max-w-2xl w-full max-h-[90vh] overflow-hidden flex flex-col'>
        {/* 头部 */}
        <div className='flex items-center justify-between p-6 border-b border-gray-200 dark:border-gray-700'>
          <div className='flex items-center space-x-3'>
            <Key className='w-5 h-5 text-primary-600' />
            <h3 className='text-lg font-semibold text-gray-900 dark:text-white'>
              TVBox Token 管理 - {username}
            </h3>
          </div>
          <button
            onClick={onClose}
            className='p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded'
          >
            <X className='w-5 h-5' />
          </button>
        </div>

        {/* 内容 */}
        <div className='flex-1 overflow-y-auto p-6 space-y-6'>
          {/* 消息提示 */}
          {message && (
            <div
              className={`p-3 rounded-lg ${
                message.type === 'success'
                  ? 'bg-primary-50 dark:bg-primary-900/20 text-primary-700 dark:text-primary-300'
                  : 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300'
              }`}
            >
              {message.text}
            </div>
          )}

          {/* Token 状态 */}
          <div className='space-y-2'>
            <label className='block text-sm font-medium text-gray-700 dark:text-gray-300'>
              当前Token
            </label>
            {tvboxToken ? (
              <div className='p-3 bg-gray-50 dark:bg-gray-700 rounded-lg font-mono text-sm text-gray-900 dark:text-gray-100 break-all'>
                {tvboxToken}
              </div>
            ) : (
              <div className='p-3 bg-yellow-50 dark:bg-yellow-900/20 text-yellow-700 dark:text-yellow-300 rounded-lg text-sm'>
                该用户尚未设置 TVBox Token
              </div>
            )}
          </div>

          <div className='p-3 bg-primary-50 dark:bg-primary-900/20 text-primary-700 dark:text-primary-300 rounded-lg text-sm'>
            TVBox
            可访问源与该账号的站内源权限完全一致。请在用户列表的“采集源权限”或“用户组”中调整。
          </div>
        </div>

        {/* 底部操作按钮 */}
        <div className='flex items-center justify-end p-6 border-t border-gray-200 dark:border-gray-700'>
          <div className='flex items-center space-x-2'>
            <button
              onClick={onClose}
              disabled={isSaving}
              className='px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg disabled:opacity-50'
            >
              取消
            </button>
            <button
              onClick={handleRegenerate}
              disabled={isSaving}
              className='px-4 py-2 text-sm bg-primary-100 dark:bg-primary-900 text-primary-700 dark:text-primary-300 hover:bg-primary-200 dark:hover:bg-primary-800 rounded-lg disabled:opacity-50 flex items-center space-x-1'
            >
              <Settings className='w-4 h-4' />
              <span>{tvboxToken ? '重新生成' : '生成Token'}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
