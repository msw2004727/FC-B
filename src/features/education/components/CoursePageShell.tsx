import './course.css';
import type { ComponentChildren, JSX } from 'preact';
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
