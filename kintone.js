(function() {
  'use strict';

  // --- 設定値 ---
  const lookupFieldCode = 'ルックアップ_購入商品';
  const wholesaleFlagFieldCode = 'wholesale_flag'; // 卸フラグ用
  const giftFlagFieldCode = 'gift_flag';      // Amazonギフト券フラグ用
  // --- 設定値ここまで ---

  kintone.events.on(['app.record.create.submit', 'app.record.edit.submit'], function(event) {
    const record = event.record;

    // ルックアップフィールドやその値が存在しない場合のエラーを防止する
    if (!record[lookupFieldCode] || typeof record[lookupFieldCode].value === 'undefined') {
      return event;
    }

    // ルックアップフィールドの値（商品名）を取得
    const lookupValue = record[lookupFieldCode].value;

    // 各フラグを一旦リセット
    record[wholesaleFlagFieldCode].value = '';
    record[giftFlagFieldCode].value = '';

    // 値の存在チェックと型チェック
    if (lookupValue && typeof lookupValue === 'string') {

      // 「卸」のチェック
      if (lookupValue.includes('卸')) {
        record[wholesaleFlagFieldCode].value = '卸';
      }

      // 「Amazonギフト券」のチェック
      if (lookupValue.includes('Amazonギフト券あり')) {
        record[giftFlagFieldCode].value = 'Amazonギフトあり';
      }
    }
    
    return event;
  });

})();


