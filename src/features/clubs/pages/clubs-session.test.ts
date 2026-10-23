import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loginForClubs } from './clubs-session';

const signIn = vi.hoisted(() => vi.fn());
const isLoginRedirectingError = vi.hoisted(() => vi.fn());

vi.mock('@/data/auth', () => ({
  signIn,
  isLoginRedirectingError,
}));

beforeEach(() => {
  signIn.mockReset();
  isLoginRedirectingError.mockReset();
});

async function waitForSignIn(times: number): Promise<void> {
  await vi.waitFor(() => {
    expect(signIn).toHaveBeenCalledTimes(times);
  });
}

describe('loginForClubs', () => {
  it('calls signIn once', async () => {
    signIn.mockResolvedValue({ uid: 'u1' });
    await loginForClubs();
    expect(signIn).toHaveBeenCalledTimes(1);
  });

  it('swallows LoginRedirectingError', async () => {
    const err = new Error('redirect');
    signIn.mockRejectedValue(err);
    isLoginRedirectingError.mockReturnValue(true);
    await expect(loginForClubs()).resolves.toBeUndefined();
    expect(signIn).toHaveBeenCalledTimes(1);
    expect(isLoginRedirectingError).toHaveBeenCalledWith(err);
  });

  it('rethrows other errors', async () => {
    const err = new Error('boom');
    signIn.mockRejectedValue(err);
    isLoginRedirectingError.mockReturnValue(false);
    await expect(loginForClubs()).rejects.toBe(err);
    expect(signIn).toHaveBeenCalledTimes(1);
  });

  it('returns the same promise while signIn is in flight and calls signIn again after it settles', async () => {
    let resolveSignIn!: (value: { uid: string }) => void;
    const pending = new Promise<{ uid: string }>((resolve) => {
      resolveSignIn = resolve;
    });
    signIn.mockReturnValue(pending);

    const first = loginForClubs();
    const second = loginForClubs();
    expect(second).toBe(first);
    await waitForSignIn(1);

    resolveSignIn({ uid: 'u1' });
    await first;

    const third = loginForClubs();
    expect(third).not.toBe(first);
    await third;
    expect(signIn).toHaveBeenCalledTimes(2);
  });

  it('shares one rejection and allows another signIn after a non-redirect error', async () => {
    const err = new Error('boom');
    let rejectSignIn!: (reason: unknown) => void;
    signIn.mockReturnValueOnce(new Promise<never>((_resolve, reject) => {
      rejectSignIn = reject;
    }));
    isLoginRedirectingError.mockReturnValue(false);

    const first = loginForClubs();
    const second = loginForClubs();
    expect(second).toBe(first);
    const caught = Promise.all([
      first.then(() => {
        throw new Error('should reject');
      }, (reason: unknown) => reason),
      second.then(() => {
        throw new Error('should reject');
      }, (reason: unknown) => reason),
    ]);
    await waitForSignIn(1);
    rejectSignIn(err);
    await expect(caught).resolves.toEqual([err, err]);
    expect(signIn).toHaveBeenCalledTimes(1);

    signIn.mockResolvedValueOnce({ uid: 'u1' });
    await expect(loginForClubs()).resolves.toBeUndefined();
    expect(signIn).toHaveBeenCalledTimes(2);
  });

  it('allows another signIn after LoginRedirectingError is swallowed', async () => {
    const err = new Error('redirect');
    signIn.mockRejectedValueOnce(err);
    isLoginRedirectingError.mockReturnValueOnce(true);
    await expect(loginForClubs()).resolves.toBeUndefined();

    signIn.mockResolvedValueOnce({ uid: 'u1' });
    await expect(loginForClubs()).resolves.toBeUndefined();
    expect(signIn).toHaveBeenCalledTimes(2);
  });
});
