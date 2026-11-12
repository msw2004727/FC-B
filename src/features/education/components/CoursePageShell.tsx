import './course.css';
import type { ComponentChildren, JSX } from 'preact';
import { PageSpinner } from '@/ui/PageSpinner';
import { IconBack } from './icons';

export function CoursePageShell({
  title,
  backLabel,
  onBack,
  children,
}: {
  title: string;
  backLabel: string;
  onBack: () => void;
  children: ComponentChildren;
}): JSX.Element {
  return (
    <section class="ck ck-page" data-course-page>
      <div class="ck-top">
        <button type="button" class="ck-round" aria-label={backLabel} onClick={onBack}>
          <IconBack />
        </button>
        <div class="ck-top-title">{title}</div>
        <span class="ck-top-pad" />
      </div>
      {children}
    </section>
  );
}

export function CourseStatus({
  kind,
  text,
  onRetry,
  retryText,
}: {
  kind: 'loading' | 'error' | 'empty';
  text: string;
  onRetry?: () => void;
  retryText?: string;
}): JSX.Element {
  // 課程詳情、課堂、登入未定都走這裡：整區等待用既有 PageSpinner。空與錯誤維持虛線框。
  if (kind === 'loading') {
    return (
      <div data-status="loading">
        <PageSpinner />
      </div>
    );
  }
  return (
    <div class="ck-empty" role={kind === 'error' ? 'alert' : undefined} data-status={kind}>
      <div>{text}</div>
      {onRetry ? (
        <button type="button" class="ck-btn ck-btn-o" onClick={onRetry}>
          {retryText}
        </button>
      ) : null}
    </div>
  );
}
