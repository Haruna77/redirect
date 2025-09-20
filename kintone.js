(function() {
  'use strict';

  // --- 設定値 ---
  const lookupFieldCode = 'ルックアップ_購入商品'; 
  const copiedProductNameFieldCode = 'copied_product_name';
  
  // フラグ用のフィールド
  const wholesaleFlagFieldCode = 'wholesale_flag'; // 卸フラグ用
  const giftFlagFieldCode = 'gift_flag';      // Amazonギフト券フラグ用
  // --- 設定値ここまで ---

  // チェックと値設定を行う共通関数
  const checkAndUpdateFlags = (record) => {
    const productName = record[copiedProductNameFieldCode].value;

    // 各フラグを一旦リセット
    record[wholesaleFlagFieldCode].value = '';
    record[giftFlagFieldCode].value = '';

    // 値の存在チェックと型チェック
    if (productName && typeof productName === 'string') {
      
      // 「卸」のチェック
      if (productName.includes('卸')) {
        record[wholesaleFlagFieldCode].value = '卸';
      }

      // 「Amazonギフト券」のチェック
      if (productName.includes('Amazonギフト券')) {
        record[giftFlagFieldCode].value = 'Amazonギフトあり';
      }
    }
  };

  // イベントハンドラー
  const events = [
    'app.record.create.change.' + lookupFieldCode,
    'app.record.edit.change.' + lookupFieldCode,
    'app.record.create.submit',
    'app.record.edit.submit'
  ];

  kintone.events.on(events, function(event) {
    const record = event.record;
    checkAndUpdateFlags(record);
    return event;
  });

})();

