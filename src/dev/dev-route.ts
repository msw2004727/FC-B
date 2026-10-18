export const DEV_ROUTES = import.meta.env.DEV ? [{ path: '/dev/ui', load: () => import('./UiGallery') }] : [];
