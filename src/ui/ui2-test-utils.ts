import { _setDictLoaderForTest, setLocale } from '@/i18n/i18n';

/** 使用正式核心及功能字典，保持真實 t / useT。 */
export async function prepareUi2Locale(): Promise<void> {
  _setDictLoaderForTest(null);
  await setLocale('zh-TW');
}

export function resetUi2Locale(): void {
  _setDictLoaderForTest(null);
}
