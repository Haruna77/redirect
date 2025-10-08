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
 * in the "Purchaser Information" app (購入者情報), copies specified fields, waits for the
 * new Purchaser ID to be generated, and writes that new ID back to the original payment record.
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
  // ★要設定: 【購入者情報】の「顧客ID」フィールドコード
  const TARGET_PURCHASER_ID_CODE = 'purchaser_id';

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

  /**
   * 少し待機するための関数
   * @param {number} ms 待機するミリ秒
   */
  const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

  /**
   * 【購入者情報】アプリで自動生成された顧客IDを取得する関数
   * IDが生成されるまで数回リトライします。
   * @param {string} recordId 【購入者情報】に作成されたレコードのID
   * @returns {Promise<string>} 生成された顧客ID
   */
  const getGeneratedPurchaserId = async (recordId) => {
    // ▼▼▼ 変更点 ▼▼▼
    // ID生成の反映を待つ時間を延長し、より安定させます。
    const MAX_RETRIES = 10; // 最大10回まで試行
    const RETRY_INTERVAL = 1000; // 1秒ごとに確認 (合計で最大約10秒待つ)

    for (let i = 0; i < MAX_RETRIES; i++) {
      try {
        await sleep(RETRY_INTERVAL);
        const resp = await kintone.api(kintone.api.url('/k/v1/record', true), 'GET', {
          app: TARGET_APP_ID,
          id: recordId
        });
        const purchaserId = resp.record[TARGET_PURCHASER_ID_CODE].value;
        if (purchaserId) {
          console.log(`Successfully retrieved generated ID after ${i + 1} attempt(s): ${purchaserId}`);
          return purchaserId;
        }
        console.log(`Attempt ${i + 1}: Purchaser ID is not generated yet. Retrying...`);
      } catch (e) {
        console.error(`Attempt ${i + 1} failed to get record. Retrying...`, e);
      }
    }
    // ▲▲▲ 変更ここまで ▲▲▲
    throw new Error('Failed to retrieve the generated Purchaser ID from the target app.');
  };

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
      const newRecordId = postResp.id;
      console.log(`Created new preliminary purchaser record in App ${TARGET_APP_ID} with Record ID: ${newRecordId}`);

      // --- 3. 【購入者情報】で自動生成された新しい顧客IDを取得する ---
      const newPurchaserId = await getGeneratedPurchaserId(newRecordId);

      // --- 4. 取得したIDを、今まさに保存しようとしている【決済管理表】のレコードに書き戻す ---
      record[SOURCE_PURCHASER_ID_CODE].value = newPurchaserId;
      console.log(`New Purchaser ID ${newPurchaserId} has been set to the current record.`);

    } catch (error) {
      console.error('Error during new purchaser auto-creation process:', error);
      event.error = '新規顧客の自動登録中にエラーが発生しました。詳細はコンソールログを確認してください。 ' + error.message;
    }

    return event;
  });

})();

