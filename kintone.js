(function() {
  'use strict';

  // --- 機能1: 購入商品に応じたフラグ設定 ------------------------------------
  (function() {
    // --- 設定値 ---
    const lookupFieldCode = 'ルックアップ_購入商品';
    const wholesaleFlagFieldCode = 'wholesale_flag'; // 卸フラグ用
    const giftFlagFieldCode = 'gift_flag';       // Amazonギフト券フラグ用
    // --- 設定値ここまで ---

    kintone.events.on(['app.record.create.submit', 'app.record.edit.submit'], function(event) {
      const record = event.record;

      if (!record[lookupFieldCode] || typeof record[lookupFieldCode].value === 'undefined') {
        return event;
      }

      const lookupValue = record[lookupFieldCode].value;
      record[wholesaleFlagFieldCode].value = '';
      record[giftFlagFieldCode].value = '';

      if (lookupValue && typeof lookupValue === 'string') {
        if (lookupValue.includes('卸')) {
          record[wholesaleFlagFieldCode].value = '卸';
        }
        if (lookupValue.includes('Amazonギフト券あり')) {
          record[giftFlagFieldCode].value = 'Amazonギフトあり';
        }
      }
      return event;
    });
  })();


  // --- 機能2: 住所コピー機能 ------------------------------------------
  (function() {
    // --- 設定値 ---
    const checkboxFieldCode = 'チェックボックス_生徒住所と同じ';
    const sourcePostalCode = '郵便番号_生徒住所';
    const sourceName       = '名前_生徒住所';
    const sourceAddress    = '住所_生徒住所_0';
    const destPostalCode   = '郵便番号_郵送先';
    const destName         = '宛名_郵送先';
    const destAddress      = '住所_郵送先';
    // --- 設定値ここまで ---

    const events = [
      'app.record.create.change.' + checkboxFieldCode,
      'app.record.edit.change.' + checkboxFieldCode
    ];

    kintone.events.on(events, function(event) {
      const record = event.record;
      const isChecked = record[checkboxFieldCode].value.length > 0;

      if (isChecked) {
        record[destPostalCode].value = record[sourcePostalCode].value;
        record[destName].value       = record[sourceName].value;
        record[destAddress].value    = record[sourceAddress].value;
      } else {
        record[destPostalCode].value = '';
        record[destName].value       = '';
        record[destAddress].value    = '';
      }
      return event;
    });
  })();

})();
/**
 * @name New Purchaser Auto-Creation
 * @description
 * This script is for the "Payment Management" app (決済管理表).
 * When a new record is saved with a blank Purchaser ID, it automatically creates a new record
 * in the "Purchaser Information" app (購入者情報) and copies specified fields.
 * NOTE: This version does NOT write the newly generated ID back to the payment record.
 *
 * @trigger app.record.create.submit
 */
(function() {
  'use strict';

  // ===================================================================================
  // 設定箇所 (User Configuration)
  // ===================================================================================
  // ★要設定: 【購入者情報】アプリのアプリID (顧客マスタ)
  const TARGET_APP_ID = 26;

  // --- フィールドコード設定 ---
  // ★要設定: 【決済管理表】の「顧客ID」フィールドコード
  const SOURCE_PURCHASER_ID_CODE = 'purchaser_id';
  
  // ★★★ここを編集★★★
  // 新規顧客作成時に【決済管理表】から【購入者情報】へコピーしたいフィールドの
  // フィールドコードを、以下のリストに追加してください。
  // (ご提示のリストを反映)
  // ※ルックアップ、計算、添付ファイル、レコード番号などのフィールドは直接コピーできません。
  const FIELDS_TO_COPY = [
    '生徒名_苗字',
    '生徒名_名前',
    'メールアドレス',
    'phone',
    '名前_生徒住所',
    '郵便番号_生徒住所',
    '住所_生徒住所_0',
    '生徒LINE名',
    '全額決済完了日',
    '決済残高',
    '文字列__1行_商品種別',
    'ドロップダウン_解約理由',
    '文字列__1行_登録経路_手入力用',
    '文字列__1行_集客媒体_報酬ランク',
    '文字列__1行_集客者_手入力用'
  ];
  // ===================================================================================

  // レコード新規保存"前"のイベント
  kintone.events.on('app.record.create.submit', async (event) => {
    const record = event.record;
    const purchaserId = record[SOURCE_PURCHASER_ID_CODE].value;

    // 既に顧客IDが入力されている場合は、何もしない
    if (purchaserId) {
      return event;
    }

    console.log('Purchaser ID is blank. Starting new purchaser creation process...');

    try {
      // --- 1. 【購入者情報】に登録するデータを作成 ---
      const newPurchaserRecord = {};
      FIELDS_TO_COPY.forEach(fieldCode => {
        // フィールドが存在し、値があればコピー対象に加える
        if (record[fieldCode] && typeof record[fieldCode].value !== 'undefined' && record[fieldCode].value !== null) {
          newPurchaserRecord[fieldCode] = {
            value: record[fieldCode].value
          };
        }
      });
      console.log('Data to be copied:', newPurchaserRecord);

      // --- 2. 【購入者情報】に新しいレコードを追加する ---
      const postResp = await kintone.api(kintone.api.url('/k/v1/record', true), 'POST', {
        app: TARGET_APP_ID,
        record: newPurchaserRecord
      });
      
      console.log(`Created new purchaser record in App ${TARGET_APP_ID} with Record ID: ${postResp.id}`);

      // ▼▼▼ 変更点 ▼▼▼
      // IDの取得と書き戻し処理を削除しました。
      // ▲▲▲ 変更ここまで ▲▲▲

    } catch (error) {
      console.error('Error during new purchaser auto-creation process:', error);
      event.error = '新規顧客の自動登録中にエラーが発生しました。詳細はコンソールログを確認してください。 ' + error.message;
    }

    return event;
  });

})();

