import type { JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { useLocation } from 'preact-iso';
import { toast } from '@/ui/Toast';
import { appConfirm } from '@/ui/AppConfirm';
import {
  buildLikerSummary,
  canManageComments,
  canReplyToComment,
  CommentActionError,
  deleteEventComment,
  eventCommentTimeLabel,
  isEventCommentsClosed,
  loadEventComments,
  setEventCommentReplyLocked,
  submitEventComment,
  submitEventCommentReply,
  writeEventCommentLike,
  type CommentContext,
  type CommentItem,
  type Liker,
  commentEventEndMs,
} from '../../data/event-comments';
import {
  getEventCommentAuthor,
  type PublicIdentitySnapshot,
} from '../../data/identity-snapshot';

export interface EventCommentsSectionProps extends CommentContext {
  canLoad: boolean;
}

const RETRY_DELAYS = [3000, 15000] as const;
const LOAD_TIMEOUT = 9000;
const HARD_STOP = 45000;

function Crown(): JSX.Element {
  return (
    <svg class="identity-crown" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id="identityCrownGold" x1="3" y1="5" x2="20" y2="19" gradientUnits="userSpaceOnUse">
          <stop offset="0" stop-color="#fff4c2" />
          <stop offset=".42" stop-color="#ffd24a" />
          <stop offset=".72" stop-color="#f2a517" />
          <stop offset="1" stop-color="#b5710b" />
        </linearGradient>
        <clipPath id="identityCrownClip">
          <path d="M2.7 9.1 6.8 13 12 5.6 17.2 13 21.3 9.1V16.4q0 1.7-1.7 1.7H4.4Q2.7 18.1 2.7 16.4Z" />
        </clipPath>
      </defs>
      <path class="identity-crown-body" d="M2.7 9.1 6.8 13 12 5.6 17.2 13 21.3 9.1V16.4q0 1.7-1.7 1.7H4.4Q2.7 18.1 2.7 16.4Z" />
      <path class="identity-crown-band" d="M4 15.3h16" />
      <circle class="identity-crown-gem" cx="12" cy="5.9" r="1.6" />
      <circle class="identity-crown-gem" cx="2.9" cy="9.1" r="1.3" />
      <circle class="identity-crown-gem" cx="21.1" cy="9.1" r="1.3" />
      <g clip-path="url(#identityCrownClip)">
        <rect class="identity-crown-shine" x="-9" y="-5" width="7" height="34" />
      </g>
    </svg>
  );
}

function OfficialBadge({ snapshot }: { snapshot: PublicIdentitySnapshot | null }): JSX.Element | null {
  if (snapshot?.identityId !== 'secondary') return null;
  return (
    <span class="event-comment-audit-trace event-comment-official-badge" title="ToosterX 官方認證帳號">
      <svg class="event-comment-official-check" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <circle cx="12" cy="12" r="10" />
        <path d="M10.4 15.3 6.9 11.8 8 10.7l2.4 2.4 5.6-5.6 1.1 1.1z" fill="#fff" />
      </svg>
      <span>ToosterX官方認證</span>
    </span>
  );
}

function Avatar({
  name, photo, snapshot = null, liker, index = 0,
}: {
  name: string;
  photo: string;
  snapshot?: PublicIdentitySnapshot | null;
  liker?: Liker;
  index?: number;
}): JSX.Element {
  const [failedPhoto, setFailedPhoto] = useState<string | null>(null);
  const base = liker ? 'event-comment-like-avatar' : 'event-comment-avatar';
  const initial = name.trim().charAt(0) || '?';
  const style = liker ? `--i:${index};z-index:${80 - index}` : undefined;
  const avatar = photo && failedPhoto !== photo ? (
    <img
      class={base}
      src={photo}
      alt={name || '用戶'}
      title={liker ? name : undefined}
      data-uid={liker?.uid}
      data-author-photo={liker ? photo : undefined}
      referrerPolicy="no-referrer"
      loading="lazy"
      decoding={liker ? 'async' : undefined}
      style={style}
      onError={() => setFailedPhoto(photo)}
    />
  ) : (
    <span
      class={`${base} ${base}-fallback`}
      title={liker ? name : undefined}
      data-uid={liker?.uid}
      style={style}
    >{initial}</span>
  );
  return snapshot?.identityId === 'secondary' ? (
    <span class="event-comment-avatar-wrap is-official-identity" title="官方人員（第二身份）">
      <Crown />{avatar}
    </span>
  ) : avatar;
}

function LikeIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3v11Zm3 0h7.1a2 2 0 0 0 2-1.6l1.2-6.4A2 2 0 0 0 18.3 11H14l.8-4.3a3 3 0 0 0-.8-2.7L13 3l-5 8v10a1 1 0 0 0 1 1Z" />
    </svg>
  );
}

function LikeAvatars({ item }: { item: CommentItem }): JSX.Element | null {
  const likers = item.likers.slice(0, 32);
  if (!likers.length) return null;
  const step = likers.length > 6 ? 8 : 26;
  const width = 24 + Math.max(0, likers.length - 1) * step;
  return (
    <div
      class="event-comment-like-avatars"
      aria-label={`${item.likeCount || likers.length} likes`}
      style={`--stack-width:${width}px;--step:${step}px`}
    >
      {likers.map((liker, index) => (
        <Avatar
          key={liker.uid}
          name={liker.authorName}
          photo={liker.authorPhoto}
          liker={liker}
          index={index}
        />
      ))}
    </div>
  );
}

/** 照 A _resizeEventCommentInput。 */
export function resizeEventCommentInput(input: HTMLTextAreaElement): void {
  input.style.height = 'auto';
  const max = parseFloat(window.getComputedStyle(input).maxHeight) || 160;
  input.style.height = `${Math.min(input.scrollHeight || input.offsetHeight || max, max)}px`;
  input.style.overflowY = input.scrollHeight > max ? 'auto' : 'hidden';
}

export default function EventCommentsSection(props: EventCommentsSectionProps): JSX.Element {
  const manage = canManageComments(props);
  // 身份／讀取範圍變更當次 render 即隔離私密資料。
  return (
    <CommentsSession
      key={`${props.eventDocId}:${props.event.id}:${props.viewer.uid || 'guest'}:${manage}:${props.canLoad}`}
      {...props}
    />
  );
}

function CommentsSession(props: EventCommentsSectionProps): JSX.Element {
  const location = useLocation();
  const current = useRef(props);
  current.current = props;
  const alive = useRef(true);
  const sequence = useRef(0);
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());
  const writeBusy = useRef(false);
  const likeBusy = useRef(new Set<string>());
  const input = useRef<HTMLTextAreaElement>(null);
  const replyInputs = useRef(new Map<string, HTMLInputElement>());
  const commentsRef = useRef<CommentItem[]>([]);
  const [comments, setComments] = useState<CommentItem[]>([]);
  const [status, setStatus] = useState<'loading' | 'reloading' | 'ready' | 'slow' | 'failed'>('loading');
  const [body, setBody] = useState('');
  const [privateComment, setPrivateComment] = useState(false);
  const [replyBodies, setReplyBodies] = useState<Record<string, string>>({});
  const [openReplies, setOpenReplies] = useState<ReadonlySet<string>>(new Set());
  const [busyKey, setBusyKey] = useState('');
  const [, setClock] = useState(0);

  function commit(next: CommentItem[]): void {
    if (!alive.current) return;
    commentsRef.current = next;
    setComments(next);
  }

  function clearTimers(): void {
    for (const timer of timers.current) clearTimeout(timer);
    timers.current.clear();
  }

  function schedule(fn: () => void, delay: number): ReturnType<typeof setTimeout> {
    const timer = setTimeout(() => {
      timers.current.delete(timer);
      if (alive.current) fn();
    }, delay);
    timers.current.add(timer);
    return timer;
  }

  function message(text: string): void {
    if (alive.current) toast.show({ message: text });
  }

  /** 照 A _renderEventComments／_scheduleEventCommentAutoRetry。 */
  function load(attempt = 0, startedAt = Date.now(), retry = false): void {
    if (!alive.current || !current.current.canLoad || !current.current.viewer.uid) return;
    clearTimers();
    const request = ++sequence.current;
    const valid = (): boolean => alive.current && request === sequence.current;
    setStatus(retry ? 'reloading' : 'loading');
    let timedOut = false;
    const timeout = schedule(() => {
      if (!valid()) return;
      timedOut = true;
      setStatus('slow');
      const delay = RETRY_DELAYS[attempt];
      const elapsed = Date.now() - startedAt;
      if (delay === undefined || elapsed >= HARD_STOP) {
        setStatus('failed');
        return;
      }
      schedule(() => {
        if (!valid()) return;
        if (Date.now() - startedAt >= HARD_STOP) setStatus('failed');
        else load(attempt + 1, startedAt, true);
      }, Math.min(delay, HARD_STOP - elapsed));
    }, LOAD_TIMEOUT);

    loadEventComments(current.current).then(
      (result) => {
        if (!valid()) return;
        clearTimers();
        commit(result);
        setStatus('ready');
      },
      () => {
        if (!valid()) return;
        clearTimeout(timeout);
        timers.current.delete(timeout);
        // 照 A：timeout 後的晚到失敗保留既定背景重試。
        if (!timedOut) {
          clearTimers();
          setStatus('failed');
        }
      },
    ).catch(() => {
      if (valid()) setStatus('failed');
    });
  }

  useEffect(() => {
    alive.current = true;
    load();
    // A 沒有每秒重繪；只在活動結束那一刻重算一次「留言已關閉」（Gemini 審查 P3）。
    const endMs = commentEventEndMs(current.current.event.date);
    const remain = endMs !== null ? endMs - Date.now() : -1;
    if (remain > 0 && remain < 2_147_483_647) {
      schedule(() => setClock((value) => value + 1), remain + 50);
    }
    return () => {
      alive.current = false;
      sequence.current += 1;
      clearTimers();
      replyInputs.current.clear();
    };
  }, []);

  useEffect(() => {
    if (status === 'ready' && input.current) resizeEventCommentInput(input.current);
  }, [status, body]);

  function requireUser(): boolean {
    if (current.current.viewer.uid?.trim()) return true;
    message('請先登入');
    return false;
  }

  async function write(
    key: string, task: () => Promise<void>, success: string, failure: string,
    after?: () => void,
  ): Promise<void> {
    if (!requireUser()) return;
    if (writeBusy.current) {
      message('系統已在處理中');
      return;
    }
    writeBusy.current = true;
    setBusyKey(key);
    try {
      await task();
      if (!alive.current) return;
      after?.();
      message(success);
      load(0, Date.now(), true);
    } catch (error) {
      message(error instanceof CommentActionError ? error.message : failure);
    } finally {
      writeBusy.current = false;
      if (alive.current) setBusyKey('');
    }
  }

  function submit(): void {
    write('comment', () => submitEventComment(current.current, body, privateComment),
      '留言已送出', '留言送出失敗，請稍後再試', () => {
        setBody('');
        setPrivateComment(false);
      }).catch(() => message('留言送出失敗，請稍後再試'));
  }

  function submitReply(commentId: string): void {
    const comment = commentsRef.current.find((entry) => entry.id === commentId);
    if (!comment || !requireUser()) return;
    if (isEventCommentsClosed(current.current.event)) {
      message('活動已結束，無法新增回覆');
      return;
    }
    if (!canReplyToComment(current.current.event, comment)) {
      message('權限不足');
      return;
    }
    write(`reply:${commentId}`,
      () => submitEventCommentReply(current.current, comment, replyBodies[commentId] || ''),
      '回覆已送出', '回覆送出失敗，請稍後再試', () => {
        setReplyBodies((previous) => ({ ...previous, [commentId]: '' }));
        setOpenReplies((previous) => {
          const next = new Set(previous);
          next.delete(commentId);
          return next;
        });
      }).catch(() => message('回覆送出失敗，請稍後再試'));
  }

  function toggleReply(commentId: string): void {
    const comment = commentsRef.current.find((entry) => entry.id === commentId);
    if (!comment || !canReplyToComment(current.current.event, comment)) return;
    const opening = !openReplies.has(commentId);
    setOpenReplies((previous) => {
      const next = new Set(previous);
      if (opening) next.add(commentId);
      else next.delete(commentId);
      return next;
    });
    if (opening) schedule(() => replyInputs.current.get(commentId)?.focus(), 0);
  }

  function patchLike(
    commentId: string, replyId: string, patch: Pick<CommentItem, 'likedByMe' | 'likeCount' | 'likers'>,
  ): void {
    commit(commentsRef.current.map((comment) => comment.id !== commentId ? comment : replyId
      ? { ...comment, replies: comment.replies.map((reply) => reply.id === replyId ? { ...reply, ...patch } : reply) }
      : { ...comment, ...patch }));
  }

  async function like(commentId: string, replyId = ''): Promise<void> {
    if (!requireUser()) return;
    const key = `${commentId}:${replyId}`;
    if (likeBusy.current.has(key)) return;
    const parent = commentsRef.current.find((entry) => entry.id === commentId);
    const target = replyId ? parent?.replies.find((entry) => entry.id === replyId) : parent;
    if (!target) return;
    likeBusy.current.add(key);
    const liked = !target.likedByMe;
    const old = { likedByMe: target.likedByMe, likeCount: target.likeCount, likers: target.likers };
    const summary = buildLikerSummary(getEventCommentAuthor(current.current.viewer));
    const likers = target.likers.filter((entry) => entry.uid !== summary.uid);
    if (liked) likers.unshift(summary);
    patchLike(commentId, replyId, {
      likedByMe: liked,
      likeCount: Math.max(0, target.likeCount + (liked ? 1 : -1)),
      likers: target.likers,
    });
    try {
      await writeEventCommentLike(current.current, commentId, liked, replyId);
      if (!alive.current) return;
      patchLike(commentId, replyId, {
        likedByMe: liked,
        likeCount: Math.max(0, old.likeCount + (liked ? 1 : -1)),
        likers: likers.slice(0, 32),
      });
    } catch {
      if (alive.current) patchLike(commentId, replyId, old);
      message('按讚更新失敗，請稍後再試');
    } finally {
      likeBusy.current.delete(key);
    }
  }

  function lock(commentId: string, locked: boolean): void {
    if (!requireUser()) return;
    if (!canManageComments(current.current)) {
      message('權限不足');
      return;
    }
    write(`lock:${commentId}`,
      () => setEventCommentReplyLocked(current.current, commentId, locked),
      locked ? '已鎖定回覆' : '已解除鎖定', '更新失敗，請稍後再試',
    ).catch(() => message('更新失敗，請稍後再試'));
  }

  async function remove(commentId: string, replyId = ''): Promise<void> {
    if (!requireUser()) return;
    if (!canManageComments(current.current)) {
      message('權限不足');
      return;
    }
    const confirmed = await appConfirm(replyId ? '確定刪除此回覆？' : '確定刪除此留言？');
    if (!alive.current || !confirmed) return;
    if (!canManageComments(current.current)) {
      message('權限不足');
      return;
    }
    await write(`delete:${commentId}:${replyId}`,
      () => deleteEventComment(current.current, commentId, replyId),
      replyId ? '回覆已刪除' : '留言已刪除', '刪除失敗，請稍後再試');
  }

  function likeButton(commentId: string, item: CommentItem, reply = false): JSX.Element {
    return (
      <button
        type="button"
        class={`event-comment-action event-comment-like${reply ? ' event-comment-reply-like' : ''}${item.likedByMe ? ' active' : ''}`}
        aria-pressed={item.likedByMe}
        onClick={() => {
          like(commentId, reply ? item.id : '').catch(() => message('按讚更新失敗，請稍後再試'));
        }}
      >
        <LikeIcon /><span>+{item.likeCount || 0}</span>
      </button>
    );
  }

  const manage = canManageComments(props);
  const closed = isEventCommentsClosed(props.event);

  let content: JSX.Element;
  if (!props.canLoad) {
    content = <div class="reg-loading">留言將在報名名單完成後載入...</div>;
  } else if (!props.viewer.uid) {
    content = <div class="event-comments-empty">登入後可查看與留言</div>;
  } else if (status === 'loading' || status === 'reloading') {
    content = <div class="reg-loading">{status === 'loading' ? '留言載入中...' : '留言重新載入中...'}</div>;
  } else if (status === 'slow' || status === 'failed') {
    content = (
      <div class="event-comments-empty event-comments-load-state">
        <div class="event-comments-load-title">{status === 'failed' ? '留言暫時無法載入' : '留言載入較久'}</div>
        <div class="event-comments-load-note">
          {status === 'failed'
            ? '可以先瀏覽活動資訊，稍後再重新載入留言。'
            : '網路可能較慢，系統會在背景再試一次。'}
        </div>
        <div class="event-comments-load-actions">
          <button type="button" class="event-comment-retry-btn" onClick={() => load(0, Date.now(), true)}>
            重新載入留言
          </button>
        </div>
      </div>
    );
  } else {
    content = (
      <>
        {closed ? (
          <div class="event-comments-closed">活動已結束，留言輸入已關閉</div>
        ) : (
          <form class="event-comment-form" onSubmit={(e) => { e.preventDefault(); submit(); }}>
            <textarea
              ref={input}
              id="event-comment-input"
              maxLength={300}
              rows={1}
              placeholder="輸入留言，最多 300 字"
              value={body}
              onInput={(e) => {
                setBody(e.currentTarget.value);
                resizeEventCommentInput(e.currentTarget);
              }}
            />
            <div class="event-comment-form-foot">
              <label class="event-comment-private-toggle">
                <input
                  type="checkbox"
                  id="event-comment-private"
                  checked={privateComment}
                  onChange={(e) => setPrivateComment(e.currentTarget.checked)}
                /> 私密留言（僅主辦與委託能見）
              </label>
              <button type="submit" class="event-comment-submit" disabled={busyKey === 'comment'}>
                {busyKey === 'comment' ? '送出中' : '送出'}
              </button>
            </div>
          </form>
        )}
        <div class="event-comments-list">
          {!comments.length ? <div class="event-comments-empty">尚無留言</div> : comments.map((comment) => (
            <article class="event-comment-card" data-comment-id={comment.id} key={comment.id}>
              <div class="event-comment-head">
                <Avatar name={comment.authorName} photo={comment.authorPhoto} snapshot={comment.identitySnapshot} />
                {comment.identitySnapshot?.identityId === 'secondary' ? (
                  <span class="event-comment-author event-comment-author-static">{comment.authorName}</span>
                ) : (
                  <button
                    type="button"
                    class="event-comment-author"
                    onClick={() => {
                      if (comment.authorUid) location.route(`/profile/${encodeURIComponent(comment.authorUid)}`);
                    }}
                  >{comment.authorName}</button>
                )}
                <span class="event-comment-time">{eventCommentTimeLabel(comment.createdAt)}</span>
                {comment.visibility === 'private' && <span class="event-comment-badge private">私密</span>}
                {comment.replyLocked && <span class="event-comment-badge locked">已鎖回覆</span>}
                <OfficialBadge snapshot={comment.identitySnapshot} />
                <span class="event-comment-manage">
                  {manage && (
                    <>
                      <button
                        type="button"
                        class="event-comment-mini-btn"
                        onClick={() => lock(comment.id, !comment.replyLocked)}
                      >{comment.replyLocked ? '解鎖' : '鎖回覆'}</button>
                      <button
                        type="button"
                        class="event-comment-mini-btn danger"
                        onClick={() => { remove(comment.id).catch(() => message('刪除失敗，請稍後再試')); }}
                      >刪除</button>
                    </>
                  )}
                </span>
              </div>
              {comment.deleted
                ? <div class="event-comment-deleted">留言已刪除</div>
                : <div class="event-comment-body">{comment.body}</div>}
              <div class="event-comment-actions">
                {likeButton(comment.id, comment)}
                <LikeAvatars item={comment} />
                {canReplyToComment(props.event, comment) && (
                  <button type="button" class="event-comment-action" onClick={() => toggleReply(comment.id)}>回覆</button>
                )}
              </div>
              {canReplyToComment(props.event, comment) && (
                <form
                  class="event-comment-reply-form"
                  id={`event-comment-reply-${comment.id}`}
                  hidden={!openReplies.has(comment.id)}
                  onSubmit={(e) => { e.preventDefault(); submitReply(comment.id); }}
                >
                  <input
                    ref={(node) => {
                      if (node) replyInputs.current.set(comment.id, node);
                      else replyInputs.current.delete(comment.id);
                    }}
                    maxLength={100}
                    placeholder="回覆留言，最多 100 字"
                    value={replyBodies[comment.id] || ''}
                    onInput={(e) => {
                      const value = e.currentTarget.value;
                      setReplyBodies((previous) => ({ ...previous, [comment.id]: value }));
                    }}
                  />
                  <button type="submit" disabled={busyKey === `reply:${comment.id}`}>
                    {busyKey === `reply:${comment.id}` ? '送出中' : '送出'}
                  </button>
                </form>
              )}
              {!!comment.replies.length && (
                <div class="event-comment-replies">
                  {comment.replies.map((reply) => (
                    <div class="event-comment-reply" data-comment-id={comment.id} data-reply-id={reply.id} key={reply.id}>
                      <Avatar name={reply.authorName} photo={reply.authorPhoto} snapshot={reply.identitySnapshot} />
                      <div class="event-comment-reply-main">
                        <div class="event-comment-reply-meta">
                          <span>{reply.authorName}</span>
                          <small>{eventCommentTimeLabel(reply.createdAt)}</small>
                          {manage && !reply.deleted && (
                            <button
                              type="button"
                              class="event-comment-mini-btn danger"
                              onClick={() => {
                                remove(comment.id, reply.id).catch(() => message('刪除失敗，請稍後再試'));
                              }}
                            >刪除</button>
                          )}
                        </div>
                        {reply.identitySnapshot?.identityId === 'secondary' && (
                          <div class="event-comment-reply-badge-line"><OfficialBadge snapshot={reply.identitySnapshot} /></div>
                        )}
                        <div class="event-comment-reply-body">
                          {reply.deleted ? <span class="event-comment-deleted">回覆已刪除</span> : reply.body}
                        </div>
                        {!reply.deleted && (
                          <div class="event-comment-reply-actions">
                            {likeButton(comment.id, reply, true)}
                            <LikeAvatars item={reply} />
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </article>
          ))}
        </div>
      </>
    );
  }
  return (
    <div class="detail-section event-comments-section">
      <div class="detail-section-title">留言</div>
      {content}
    </div>
  );
}
