import './heading.css';
import type { JSX } from 'preact';
import { Text } from '@/ui/Text';

export interface HeadingProps {
  level: 1 | 2 | 3 | 4;
  children: string;
  size?: 'title' | 'title-lg' | 'display';
  id?: string;
  class?: string;
}

/** 頁面負責維持單一 h1 與連續標題層級；視覺 size 不改變語意 level。 */
export function Heading({
  level,
  children,
  size = 'title',
  id,
  class: className,
}: HeadingProps): JSX.Element {
  const Tag = level === 1 ? 'h1' : level === 2 ? 'h2' : level === 3 ? 'h3' : 'h4';

  return (
    <Tag
      id={id}
      class={['ui-heading', `ui-heading--${size}`, className ?? ''].filter(Boolean).join(' ')}
    >
      <Text>{children}</Text>
    </Tag>
  );
}
