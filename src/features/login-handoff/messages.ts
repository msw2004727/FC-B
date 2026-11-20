// 轉交畫面的七語文案（站長同意的預覽 v2）。
// 不放進 src/i18n 或 features/*/locales：繁中字典會 eager 打包進首頁入口，入口預算只剩約 100 B（顧問 §3.337）。
// 這份只在發起或接手轉交時隨延後模組下載。畫面只寫「瀏覽器」，不指名 Safari。
import type { Locale } from '@/i18n/locales';

export interface HandoffText {
  closeLineHint: string;
  readyTitle: string;
  readyPrompt: string;
  goLine: string;
  pickTitle: string;
  warn: string;
  pickPrompt: string;
  pickNote: string;
  notMe: string;
  tryLater: string;
  retry: string;
  wrongTitle: string;
  wrongBody: string;
  closePage: string;
  doneTitle: string;
  doneBody: string;
  doneNote: string;
  sentOrExpired: string;
  waitTitle: string;
  waitPrompt: string;
  waitNote: string;
  remain: string;
  iDone: string;
  restart: string;
  timeoutTitle: string;
  timeoutBody: string;
  relogin: string;
  cancel: string;
  notYetTitle: string;
  notYetBody: string;
  close: string;
}

const zhTW: HandoffText = {
  closeLineHint: "回到 App 若看到 LINE 頁，按左上 × 關閉。",
  readyTitle: "記住這個數字",
  readyPrompt: "等一下在瀏覽器要選它",
  goLine: "前往 LINE 登入",
  pickTitle: '回到主畫面 App 登入',
  warn: '不是你自己剛在主畫面 App 按登入，請關閉此頁。',
  pickPrompt: '請選出主畫面 App 上顯示的數字',
  pickNote: '選錯一次，這次登入就會作廢',
  notMe: '不是我，關閉',
  tryLater: '連線不穩，請稍後再試',
  retry: '再試一次',
  wrongTitle: '數字不符',
  wrongBody: '這次登入已作廢。請回到主畫面 App 重新按登入。',
  closePage: '關閉此頁',
  doneTitle: '請回到主畫面 App',
  doneBody: '已轉交。請回到主畫面的 ToosterX App，會自動完成登入。',
  doneNote: '這個頁面不會登入，可以關掉。',
  sentOrExpired: '這次登入已送出或已失效，請回到主畫面 App 查看。',
  waitTitle: '等待瀏覽器確認',
  waitPrompt: '在剛跳出的瀏覽器選出這個數字',
  waitNote: '選好後回到這裡，會自動登入',
  remain: '剩餘 {time}',
  iDone: '我已完成',
  restart: '取消，重新登入',
  timeoutTitle: '登入已逾時',
  timeoutBody: '超過 5 分鐘沒有完成，請重新登入。',
  relogin: '重新登入',
  cancel: '取消',
  notYetTitle: '還沒收到登入資料',
  notYetBody: '請確認已在瀏覽器選好數字，再按一次「我已完成」。',
  close: '關閉',
};

const zhCN: HandoffText = {
  closeLineHint: "回到 App 若看到 LINE 页面，点左上角 × 关闭。",
  readyTitle: "记住这个数字",
  readyPrompt: "等一下在浏览器要选它",
  goLine: "前往 LINE 登录",
  pickTitle: '回到主屏幕 App 登录',
  warn: '如果不是你自己刚在主屏幕 App 点了登录，请关闭此页。',
  pickPrompt: '请选出主屏幕 App 上显示的数字',
  pickNote: '选错一次，这次登录就会作废',
  notMe: '不是我，关闭',
  tryLater: '连接不稳定，请稍后再试',
  retry: '再试一次',
  wrongTitle: '数字不符',
  wrongBody: '这次登录已作废。请回到主屏幕 App 重新点登录。',
  closePage: '关闭此页',
  doneTitle: '请回到主屏幕 App',
  doneBody: '已转交。请回到主屏幕的 ToosterX App，会自动完成登录。',
  doneNote: '这个页面不会登录，可以关掉。',
  sentOrExpired: '这次登录已送出或已失效，请回到主屏幕 App 查看。',
  waitTitle: '等待浏览器确认',
  waitPrompt: '在刚弹出的浏览器选出这个数字',
  waitNote: '选好后回到这里，会自动登录',
  remain: '剩余 {time}',
  iDone: '我已完成',
  restart: '取消，重新登录',
  timeoutTitle: '登录已超时',
  timeoutBody: '超过 5 分钟没有完成，请重新登录。',
  relogin: '重新登录',
  cancel: '取消',
  notYetTitle: '还没收到登录资料',
  notYetBody: '请确认已在浏览器选好数字，再点一次“我已完成”。',
  close: '关闭',
};

const en: HandoffText = {
  closeLineHint: "If a LINE page shows when you return to the app, tap × at the top left to close it.",
  readyTitle: "Remember this number",
  readyPrompt: "You'll pick it in the browser next",
  goLine: "Continue to LINE login",
  pickTitle: 'Sign in to the Home Screen app',
  warn: "If you didn't just tap Sign in in the Home Screen app, close this page.",
  pickPrompt: 'Pick the number shown in the Home Screen app',
  pickNote: 'One wrong pick cancels this sign-in',
  notMe: 'Not me, close',
  tryLater: 'Connection unstable. Please try again.',
  retry: 'Try again',
  wrongTitle: "Numbers don't match",
  wrongBody: 'This sign-in was cancelled. Go back to the Home Screen app and sign in again.',
  closePage: 'Close this page',
  doneTitle: 'Go back to the Home Screen app',
  doneBody: 'Handed over. Open ToosterX on your Home Screen to finish signing in.',
  doneNote: "This page won't sign you in. You can close it.",
  sentOrExpired: 'This sign-in was already sent or has expired. Check the Home Screen app.',
  waitTitle: 'Waiting for the browser',
  waitPrompt: 'Pick this number in the browser that just opened',
  waitNote: "Come back here after picking. You'll be signed in.",
  remain: '{time} left',
  iDone: "I'm done",
  restart: 'Cancel and sign in again',
  timeoutTitle: 'Sign-in timed out',
  timeoutBody: 'Not finished within 5 minutes. Please sign in again.',
  relogin: 'Sign in again',
  cancel: 'Cancel',
  notYetTitle: 'No sign-in data yet',
  notYetBody: 'Make sure you picked the number in the browser, then tap "I\'m done" again.',
  close: 'Close',
};

const ja: HandoffText = {
  closeLineHint: "アプリに戻って LINE のページが表示されたら、左上の × で閉じてください。",
  readyTitle: "この数字を覚えてください",
  readyPrompt: "このあとブラウザで選びます",
  goLine: "LINE ログインへ進む",
  pickTitle: 'ホーム画面のアプリでログイン',
  warn: 'ホーム画面のアプリでログインを押していない場合は、このページを閉じてください。',
  pickPrompt: 'ホーム画面のアプリに表示された数字を選んでください',
  pickNote: '一度でも間違えると、このログインは無効になります',
  notMe: '心当たりがない（閉じる）',
  tryLater: '接続が不安定です。しばらくしてからお試しください',
  retry: 'もう一度試す',
  wrongTitle: '数字が一致しません',
  wrongBody: 'このログインは無効になりました。ホーム画面のアプリでもう一度ログインしてください。',
  closePage: 'このページを閉じる',
  doneTitle: 'ホーム画面のアプリに戻ってください',
  doneBody: '引き渡しました。ホーム画面の ToosterX アプリに戻ると、自動でログインします。',
  doneNote: 'このページではログインしません。閉じてかまいません。',
  sentOrExpired: 'このログインは送信済みか期限切れです。ホーム画面のアプリを確認してください。',
  waitTitle: 'ブラウザでの確認待ち',
  waitPrompt: '開いたブラウザでこの数字を選んでください',
  waitNote: '選んだらここに戻ると、自動でログインします',
  remain: '残り {time}',
  iDone: '完了しました',
  restart: 'キャンセルしてログインし直す',
  timeoutTitle: 'ログインがタイムアウトしました',
  timeoutBody: '5 分以内に完了しませんでした。もう一度ログインしてください。',
  relogin: 'ログインし直す',
  cancel: 'キャンセル',
  notYetTitle: 'ログイン情報をまだ受け取っていません',
  notYetBody: 'ブラウザで数字を選んだことを確認して、もう一度「完了しました」を押してください。',
  close: '閉じる',
};

const ko: HandoffText = {
  closeLineHint: "앱으로 돌아왔을 때 LINE 페이지가 보이면 왼쪽 위 ×를 눌러 닫으세요.",
  readyTitle: "이 숫자를 기억하세요",
  readyPrompt: "다음에 브라우저에서 고르게 됩니다",
  goLine: "LINE 로그인으로 이동",
  pickTitle: '홈 화면 앱으로 로그인',
  warn: '방금 홈 화면 앱에서 로그인을 누르지 않았다면 이 페이지를 닫으세요.',
  pickPrompt: '홈 화면 앱에 표시된 숫자를 고르세요',
  pickNote: '한 번이라도 잘못 고르면 이번 로그인은 취소됩니다',
  notMe: '제가 아니에요, 닫기',
  tryLater: '연결이 불안정합니다. 잠시 후 다시 시도하세요',
  retry: '다시 시도',
  wrongTitle: '숫자가 일치하지 않습니다',
  wrongBody: '이번 로그인은 취소되었습니다. 홈 화면 앱으로 돌아가 다시 로그인하세요.',
  closePage: '이 페이지 닫기',
  doneTitle: '홈 화면 앱으로 돌아가세요',
  doneBody: '전달했습니다. 홈 화면의 ToosterX 앱으로 돌아가면 자동으로 로그인됩니다.',
  doneNote: '이 페이지에서는 로그인되지 않습니다. 닫아도 됩니다.',
  sentOrExpired: '이번 로그인은 이미 전송되었거나 만료되었습니다. 홈 화면 앱을 확인하세요.',
  waitTitle: '브라우저 확인 대기 중',
  waitPrompt: '방금 열린 브라우저에서 이 숫자를 고르세요',
  waitNote: '고른 뒤 여기로 돌아오면 자동으로 로그인됩니다',
  remain: '남은 시간 {time}',
  iDone: '완료했어요',
  restart: '취소하고 다시 로그인',
  timeoutTitle: '로그인 시간이 초과되었습니다',
  timeoutBody: '5분 안에 완료되지 않았습니다. 다시 로그인하세요.',
  relogin: '다시 로그인',
  cancel: '취소',
  notYetTitle: '아직 로그인 정보를 받지 못했습니다',
  notYetBody: '브라우저에서 숫자를 골랐는지 확인한 뒤 「완료했어요」를 다시 누르세요.',
  close: '닫기',
};

const th: HandoffText = {
  closeLineHint: "หากกลับมาที่แอปแล้วเห็นหน้า LINE ให้แตะ × มุมซ้ายบนเพื่อปิด",
  readyTitle: "จำตัวเลขนี้ไว้",
  readyPrompt: "ถัดไปต้องเลือกตัวเลขนี้ในเบราว์เซอร์",
  goLine: "ไปที่การเข้าสู่ระบบ LINE",
  pickTitle: 'เข้าสู่ระบบในแอปบนหน้าจอโฮม',
  warn: 'หากคุณไม่ได้เพิ่งกดเข้าสู่ระบบในแอปบนหน้าจอโฮม โปรดปิดหน้านี้',
  pickPrompt: 'เลือกตัวเลขที่แสดงในแอปบนหน้าจอโฮม',
  pickNote: 'เลือกผิดเพียงครั้งเดียว การเข้าสู่ระบบนี้จะถูกยกเลิก',
  notMe: 'ไม่ใช่ฉัน ปิด',
  tryLater: 'การเชื่อมต่อไม่เสถียร โปรดลองอีกครั้ง',
  retry: 'ลองอีกครั้ง',
  wrongTitle: 'ตัวเลขไม่ตรงกัน',
  wrongBody: 'การเข้าสู่ระบบนี้ถูกยกเลิกแล้ว โปรดกลับไปที่แอปบนหน้าจอโฮมแล้วเข้าสู่ระบบอีกครั้ง',
  closePage: 'ปิดหน้านี้',
  doneTitle: 'โปรดกลับไปที่แอปบนหน้าจอโฮม',
  doneBody: 'ส่งต่อแล้ว เปิด ToosterX บนหน้าจอโฮมเพื่อเข้าสู่ระบบให้เสร็จ',
  doneNote: 'หน้านี้จะไม่เข้าสู่ระบบ ปิดได้เลย',
  sentOrExpired: 'การเข้าสู่ระบบนี้ถูกส่งแล้วหรือหมดอายุ โปรดตรวจสอบที่แอปบนหน้าจอโฮม',
  waitTitle: 'รอการยืนยันในเบราว์เซอร์',
  waitPrompt: 'เลือกตัวเลขนี้ในเบราว์เซอร์ที่เพิ่งเปิดขึ้น',
  waitNote: 'เลือกแล้วกลับมาที่นี่ ระบบจะเข้าสู่ระบบให้อัตโนมัติ',
  remain: 'เหลือ {time}',
  iDone: 'ทำเสร็จแล้ว',
  restart: 'ยกเลิกและเข้าสู่ระบบใหม่',
  timeoutTitle: 'หมดเวลาเข้าสู่ระบบ',
  timeoutBody: 'ไม่เสร็จภายใน 5 นาที โปรดเข้าสู่ระบบอีกครั้ง',
  relogin: 'เข้าสู่ระบบใหม่',
  cancel: 'ยกเลิก',
  notYetTitle: 'ยังไม่ได้รับข้อมูลเข้าสู่ระบบ',
  notYetBody: 'ตรวจสอบว่าเลือกตัวเลขในเบราว์เซอร์แล้ว จากนั้นกด "ทำเสร็จแล้ว" อีกครั้ง',
  close: 'ปิด',
};

const vi: HandoffText = {
  closeLineHint: "Nếu thấy trang LINE khi quay lại ứng dụng, hãy chạm × ở góc trên bên trái để đóng.",
  readyTitle: "Hãy nhớ số này",
  readyPrompt: "Bước tiếp theo bạn sẽ chọn số này trong trình duyệt",
  goLine: "Tiếp tục đăng nhập LINE",
  pickTitle: 'Đăng nhập vào ứng dụng trên màn hình chính',
  warn: 'Nếu bạn không vừa bấm Đăng nhập trong ứng dụng trên màn hình chính, hãy đóng trang này.',
  pickPrompt: 'Chọn số đang hiện trong ứng dụng trên màn hình chính',
  pickNote: 'Chọn sai một lần, lần đăng nhập này sẽ bị hủy',
  notMe: 'Không phải tôi, đóng',
  tryLater: 'Kết nối không ổn định. Vui lòng thử lại.',
  retry: 'Thử lại',
  wrongTitle: 'Số không khớp',
  wrongBody: 'Lần đăng nhập này đã bị hủy. Hãy quay lại ứng dụng trên màn hình chính và đăng nhập lại.',
  closePage: 'Đóng trang này',
  doneTitle: 'Quay lại ứng dụng trên màn hình chính',
  doneBody: 'Đã chuyển giao. Mở ToosterX trên màn hình chính để hoàn tất đăng nhập.',
  doneNote: 'Trang này sẽ không đăng nhập. Bạn có thể đóng nó.',
  sentOrExpired: 'Lần đăng nhập này đã được gửi hoặc đã hết hạn. Hãy kiểm tra ứng dụng trên màn hình chính.',
  waitTitle: 'Đang chờ trình duyệt xác nhận',
  waitPrompt: 'Chọn số này trong trình duyệt vừa mở',
  waitNote: 'Chọn xong hãy quay lại đây, sẽ tự động đăng nhập',
  remain: 'Còn {time}',
  iDone: 'Tôi đã xong',
  restart: 'Hủy và đăng nhập lại',
  timeoutTitle: 'Đăng nhập đã hết thời gian',
  timeoutBody: 'Chưa hoàn tất trong 5 phút. Vui lòng đăng nhập lại.',
  relogin: 'Đăng nhập lại',
  cancel: 'Hủy',
  notYetTitle: 'Chưa nhận được dữ liệu đăng nhập',
  notYetBody: 'Hãy chắc chắn đã chọn số trong trình duyệt, rồi bấm "Tôi đã xong" lần nữa.',
  close: 'Đóng',
};

const TEXT: Record<Locale, HandoffText> = {
  'zh-TW': zhTW,
  'zh-CN': zhCN,
  en,
  ja,
  vi,
  th,
  ko,
};

export function handoffText(locale: Locale): HandoffText {
  return TEXT[locale] ?? zhTW;
}

export const HANDOFF_TEXT_FOR_TEST = TEXT;
