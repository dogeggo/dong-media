'use client';

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';

import type {
  DownloadProgress,
  M3U8DownloadTask,
  PauseResumeController,
  StreamSaverMode,
} from '@/lib/download';
import {
  detectStreamModeSupport,
  getBestStreamMode,
  type StreamModeSupport,
} from '@/lib/download/stream-mode-detector';

let downloadRuntimePromise: Promise<typeof import('@/lib/download')> | null =
  null;

function loadDownloadRuntime() {
  downloadRuntimePromise ??= import('@/lib/download');
  return downloadRuntimePromise;
}

export interface DownloadSettings {
  concurrency: number; // 并发线程数
  maxRetries: number; // 最大重试次数
  streamMode: StreamSaverMode; // 下载模式
  defaultType: 'TS' | 'MP4'; // 默认格式
}

interface DownloadContextType {
  tasks: M3U8DownloadTask[];
  showDownloadPanel: boolean;
  setShowDownloadPanel: (show: boolean) => void;
  settings: DownloadSettings;
  setSettings: (settings: DownloadSettings) => void;
  streamModeSupport: StreamModeSupport;
  createTask: (
    url: string,
    title: string,
    type?: 'TS' | 'MP4',
  ) => Promise<void>;
  startTask: (taskId: string) => Promise<void>;
  pauseTask: (taskId: string) => void;
  cancelTask: (taskId: string) => void;
  retryFailedSegments: (taskId: string) => void;
  getProgress: (taskId: string) => number;
}

const DownloadContext = createContext<DownloadContextType | undefined>(
  undefined,
);

export function DownloadProvider({ children }: { children: React.ReactNode }) {
  const [tasks, setTasks] = useState<M3U8DownloadTask[]>([]);
  const tasksRef = useRef<M3U8DownloadTask[]>([]);
  const [showDownloadPanel, setShowDownloadPanel] = useState(false);
  const [streamModeSupport, setStreamModeSupport] = useState<StreamModeSupport>(
    {
      fileSystem: false,
      serviceWorker: false,
      blob: true,
    },
  );

  // 下载设置（从 localStorage 恢复或使用默认值）
  const [settings, setSettings] = useState<DownloadSettings>(() => {
    if (typeof window === 'undefined') {
      return {
        concurrency: 6,
        maxRetries: 3,
        streamMode: 'disabled' as StreamSaverMode,
        defaultType: 'TS' as 'TS' | 'MP4',
      };
    }

    const savedSettings = localStorage.getItem('downloadSettings');
    if (savedSettings) {
      try {
        return JSON.parse(savedSettings);
      } catch {
        // 解析失败，使用默认值
      }
    }

    // 自动检测最佳模式
    const bestMode = getBestStreamMode();
    return {
      concurrency: 6,
      maxRetries: 3,
      streamMode: bestMode,
      defaultType: 'TS' as 'TS' | 'MP4',
    };
  });

  // 检测浏览器支持情况
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const support = detectStreamModeSupport();
      setStreamModeSupport(support);
    }
  }, []);

  // 保存设置到 localStorage
  useEffect(() => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('downloadSettings', JSON.stringify(settings));
    }
  }, [settings]);

  // 存储每个任务的控制器和 AbortController
  const taskControllers = useRef<
    Map<
      string,
      {
        pauseController: PauseResumeController;
        abortController: AbortController;
      }
    >
  >(new Map());

  const updateTask = useCallback(
    (taskId: string, updates: Partial<M3U8DownloadTask>) => {
      const nextTasks = tasksRef.current.map((task) =>
        task.id === taskId ? { ...task, ...updates } : task,
      );
      tasksRef.current = nextTasks;
      setTasks(nextTasks);
    },
    [],
  );

  const startTask = useCallback(
    async (taskId: string) => {
      const task = tasksRef.current.find((item) => item.id === taskId);
      if (!task) return;

      const { downloadM3U8Video, PauseResumeController } =
        await loadDownloadRuntime();

      // 创建新的控制器
      const pauseController = new PauseResumeController();
      const abortController = new AbortController();
      taskControllers.current.set(taskId, { pauseController, abortController });

      // 更新状态为下载中
      updateTask(taskId, { status: 'downloading' });

      try {
        // 开始下载（使用用户设置）
        await downloadM3U8Video(
          task,
          (progress: DownloadProgress) => {
            // 更新进度
            updateTask(taskId, {
              finishNum: progress.current,
              downloadIndex: progress.current,
            });
          },
          abortController.signal,
          pauseController,
          settings.concurrency, // 使用设置的并发数
          settings.streamMode, // 使用设置的下载模式
          settings.maxRetries, // 使用设置的重试次数
        );

        // 下载完成
        updateTask(taskId, { status: 'done' });
        console.log('下载完成:', task.title);
      } catch (error: unknown) {
        if (error instanceof Error && error.name === 'AbortError') {
          // 用户取消
          console.log('下载已取消:', task.title);
        } else {
          // 下载错误
          console.error('下载错误:', task.title, error);
          updateTask(taskId, { status: 'error' });
        }
      } finally {
        // 清理控制器
        taskControllers.current.delete(taskId);
      }
    },
    [settings, updateTask],
  );

  const createTask = useCallback(
    async (url: string, title: string, type: 'TS' | 'MP4' = 'TS') => {
      try {
        const { parseM3U8 } = await loadDownloadRuntime();
        const m3u8Task = await parseM3U8(url);

        const taskId = `task_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
        const newTask: M3U8DownloadTask = {
          ...m3u8Task,
          id: taskId,
          title,
          type,
          status: 'ready',
        };

        const nextTasks = [...tasksRef.current, newTask];
        tasksRef.current = nextTasks;
        setTasks(nextTasks);

        setShowDownloadPanel(true);
        // 任务先进入同步 ref，再启动，避免读取到 React 的旧闭包。
        await startTask(taskId);
      } catch (error) {
        console.error('创建下载任务失败:', error);
        throw error;
      }
    },
    [startTask],
  );

  const pauseTask = useCallback(
    (taskId: string) => {
      const controllers = taskControllers.current.get(taskId);
      if (controllers) {
        controllers.pauseController.pause();
        updateTask(taskId, { status: 'pause' });
      }
    },
    [updateTask],
  );

  const cancelTask = useCallback((taskId: string) => {
    const controllers = taskControllers.current.get(taskId);
    if (controllers) {
      controllers.abortController.abort();
      taskControllers.current.delete(taskId);
    }

    const nextTasks = tasksRef.current.filter((task) => task.id !== taskId);
    tasksRef.current = nextTasks;
    setTasks(nextTasks);
  }, []);

  const retryFailedSegments = useCallback(
    async (taskId: string) => {
      const task = tasksRef.current.find((item) => item.id === taskId);
      if (!task) return;

      // 重置错误计数
      updateTask(taskId, { errorNum: 0 });

      // 重新开始下载
      await startTask(taskId);
    },
    [startTask, updateTask],
  );

  const getProgress = useCallback(
    (taskId: string): number => {
      const task = tasks.find((t) => t.id === taskId);
      if (!task) return 0;

      const total = task.rangeDownload.targetSegment;
      if (total === 0) return 0;

      return (task.finishNum / total) * 100;
    },
    [tasks],
  );

  return (
    <DownloadContext.Provider
      value={{
        tasks,
        showDownloadPanel,
        setShowDownloadPanel,
        settings,
        setSettings,
        streamModeSupport,
        createTask,
        startTask,
        pauseTask,
        cancelTask,
        retryFailedSegments,
        getProgress,
      }}
    >
      {children}
    </DownloadContext.Provider>
  );
}

export function useDownload() {
  const context = useContext(DownloadContext);
  if (context === undefined) {
    throw new Error('useDownload must be used within a DownloadProvider');
  }
  return context;
}
