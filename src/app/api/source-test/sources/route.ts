import { NextRequest, NextResponse } from 'next/server';

import { getAdminRoleFromRequest } from '@/lib/admin-auth';
import { noStoreResponseHeaders } from '@/lib/cache-system';
import { loadConfig } from '@/lib/config';

export const runtime = 'nodejs';

// 返回所有源（包含禁用状态），仅暴露必要字段
export async function GET(request: NextRequest) {
  const role = await getAdminRoleFromRequest(request);
  if (!role) {
    return NextResponse.json(
      { error: '你没有权限访问源检测功能' },
      { status: 401 },
    );
  }

  try {
    const config = await loadConfig();
    const sources = (config.SourceConfig || []).map((s: any) => ({
      key: s.key,
      name: s.name,
      api: s.api,
      disabled: !!s.disabled,
    }));

    return NextResponse.json(
      { sources },
      {
        headers: noStoreResponseHeaders(),
      },
    );
  } catch (_error) {
    return NextResponse.json({ error: '获取源列表失败' }, { status: 500 });
  }
}
