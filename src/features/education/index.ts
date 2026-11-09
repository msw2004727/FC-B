import type { FeatureManifest, FeatureRoute } from '@/core/feature-types';
import { isCoursesEnabled } from './flags';

// 課程（站長 11-09 推翻 10-27「不做」，方案丙；取代原本 reserved 的占位頁）。K3 驗收前由 flags.ts 的 SHOW_COURSES 關著：
// 關閉時 reserved、不帶路由（建置期常數，關閉時課程頁面不進主程式），俱樂部頁也不出「課程」頁籤
// （TeamDetailPage 以 isFeatureEnabled('education') 判斷）。頁面全部動態載入。
function courseRoutes(): FeatureRoute[] {
  const pages = () => import('./pages/course-pages');
  const titleKey = 'education.title';
  return [
    { path: '/courses/:teamId/:planId', titleKey, load: () => pages().then((m) => ({ default: m.CourseDetailPage })) },
    { path: '/courses/:teamId/:planId/lessons', titleKey, load: () => pages().then((m) => ({ default: m.CourseLessonsPage })) },
    // K2／K3 的開課與管理頁還沒做；K1 只放入口。
    { path: '/course-manage/:teamId', titleKey, load: () => pages().then((m) => ({ default: m.CourseManagePage })) },
    { path: '/course-manage/:teamId/:planId', titleKey, load: () => pages().then((m) => ({ default: m.CourseManagePage })) },
  ];
}

export const manifest: FeatureManifest = {
  id: 'education',
  status: isCoursesEnabled() ? 'enabled' : 'reserved',
  dependsOn: ['clubs'],
  routes: isCoursesEnabled() ? courseRoutes() : [],
};
