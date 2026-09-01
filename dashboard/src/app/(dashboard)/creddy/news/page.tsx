import { requireRole } from '@/lib/auth';
import { NewsManager } from './news-manager';

export default async function NewsPage() {
  const user = await requireRole('viewer');
  return <NewsManager canEdit={user.role === 'admin' || user.role === 'editor'} />;
}
