'use client';

import { User } from 'lucide-react';
import dynamic from 'next/dynamic';
import { useState } from 'react';

const UserMenu = dynamic(
  () => import('./UserMenu').then((module) => module.UserMenu),
  {
    ssr: false,
    loading: () => <UserMenuButton disabled />,
  },
);

function UserMenuButton({
  disabled = false,
  onClick,
}: {
  disabled?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type='button'
      onClick={onClick}
      disabled={disabled}
      className='group relative flex h-10 w-10 items-center justify-center rounded-full p-2 text-gray-600 transition-all duration-300 hover:scale-110 hover:text-primary-500 hover:shadow-lg hover:shadow-primary-500/30 disabled:cursor-wait disabled:opacity-70 dark:text-gray-300 dark:hover:text-primary-400 dark:hover:shadow-primary-400/30'
      aria-label={disabled ? '正在加载用户菜单' : '打开用户菜单'}
    >
      <span className='absolute inset-0 rounded-full bg-linear-to-br from-primary-400/0 to-purple-600/0 transition-all duration-300 group-hover:from-primary-400/20 group-hover:to-purple-600/20 dark:group-hover:from-primary-300/20 dark:group-hover:to-purple-500/20' />
      <User className='relative z-10 h-full w-full transition-transform duration-300 group-hover:scale-110' />
    </button>
  );
}

export function DeferredUserMenu() {
  const [activated, setActivated] = useState(false);

  if (activated) {
    return <UserMenu initialOpen />;
  }

  return <UserMenuButton onClick={() => setActivated(true)} />;
}
