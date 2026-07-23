// ============================================================
// persistenceGuard.ts — 全域「持久化暫停」旗標。
//
// 用途：功能導覽（Spotlight Tour）期間會把使用者的真實資料（模板庫、熱鍵
// 對映表）暫時換成示範資料。這些 store 以 deep watch 即時寫入 localStorage，
// 若不攔截，示範資料會被寫檔；導覽中途關分頁/崩潰時 restore 來不及跑，
// 使用者的真實資料就被覆蓋（資料損失）。
//
// 機制：導覽開始 suspend()，各持久化 watch 於寫入前呼叫 isSuspended() 早退，
// 導覽結束 restore() 把真值指派回 ref 後再 resume()——該指派會觸發 watch
// 於下一輪以「真值 + 已恢復寫入」重新寫檔，localStorage 保證與記憶體一致。
//
// 注意：這是「單向保險」——只擋寫入，不擋讀取；示範期間記憶體照常變動，
// 只是不落地。故任何持久化來源都應在其 watch 首行呼叫 isSuspended()。
// ============================================================

import { ref } from 'vue';

/** 是否暫停所有 localStorage 持久化（導覽期間為 true）。 */
const suspended = ref(false);

/** 持久化 watch 於寫入前呼叫：回傳 true 表示現在應略過寫入。 */
export function isPersistenceSuspended(): boolean {
  return suspended.value;
}

/** 暫停持久化（導覽 begin 時呼叫，須早於任何示範資料注入）。 */
export function suspendPersistence(): void {
  suspended.value = true;
}

/** 恢復持久化（導覽收尾、restore 還原真值之後呼叫）。 */
export function resumePersistence(): void {
  suspended.value = false;
}
