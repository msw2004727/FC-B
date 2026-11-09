// 課程路由頁面的單一進入點（manifest 只有一個動態載入點）。
import type { JSX } from 'preact';
import { PlaceholderPage } from '@/ui/PlaceholderPage';

export { default as CourseDetailPage } from './CourseDetailPage';
export { default as CourseLessonsPage } from './CourseLessonsPage';

/** K2／K3 才做的開課與管理頁；K1 只放入口。 */
export function CourseManagePage(): JSX.Element {
  return <PlaceholderPage titleKey="education.title" />;
}
