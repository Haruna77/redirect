/**
 * Kintone Customization Script for 決済管理表
 * This script combines three functions:
 * 1. Sets flags based on the purchased product.
 * 2. Copies address details based on a checkbox.
 * 3. Automatically creates a new purchaser record if the purchaser ID is blank,
 * generates a new ID, updates the new record with that ID, and writes it back.
 * This version supports copying data into a table in the target app.
 */
(function() {
  'use strict';

  // --- 機能1: 購入商品に応じたフラグ設定 ------------------------------------
  (function() {
    // --- 設定値 ---
    const lookupFieldCode = 'ルックアップ_購入商品';
    const wholesaleFlagFieldCode = 'wholesale_flag'; // 卸フラグ用
    const giftFlagFieldCode = 'gift_flag';      // Amazonギフト券フラグ用
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
    const sourceName        = '名前_生徒住所';
    const sourceAddress     = '住所_生徒住所_0';
    const destPostalCode    = '郵便番号_郵送先';
    const destName          = '宛名_郵送先';
    const destAddress       = '住所_郵送先';
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

  // --- 機能3: 新規顧客の自動登録とID生成 --------------------------------------
  /**
   * @name New Purchaser Auto-Creation & ID Generation
   */
  (function() {
    // ===================================================================================
    // 設定箇所 (User Configuration)
    // ===================================================================================
    const TARGET_APP_ID = 26;
    const SOURCE_PURCHASER_ID_CODE = 'purchaser_id';
    const TARGET_PURCHASER_ID_CODE = 'purchaser_id';

    // --- ID生成ルール (【購入者情報】の customer-id-generator.js と設定を合わせる) ---
    const ID_PREFIX = 'C-';
    const PADDING_LENGTH = 7;

    // ▼▼▼ 変更点 ▼▼▼
    // ★要設定：【購入者情報】にあるテーブル自体のフィールドコード
    const TARGET_TABLE_CODE = 'テーブル_決済管理表の情報_購入履歴';

    // テーブルの外にあるフィールドをコピーするためのリスト
    const FIELDS_TO_COPY = [
      '生徒名_苗字',
      '生徒名_名前',
      'メールアドレス',
      'phone',
      '名前_生徒住所',
      '郵便番号_生徒住所',
      '住所_生徒住所_0',
      '生徒LINE名',
      '文字列__1行_登録経路_手入力用',
      '文字列__1行_集客媒体_報酬ランク',
      '文字列__1行_集客者_手入力用'
    ];

    // テーブルの中にコピーするためのリスト
    // ※注意：コピー先のフィールドの種類は、ルックアップではなく「文字列(1行)」などである必要があります。
    const FIELDS_TO_COPY_INTO_TABLE = [
      '全額決済完了日',
      '決済残高',
      '文字列__1行_商品種別',
      'ドロップダウン_解約理由',
      'ルックアップ_購入商品',
      'クローザー_ルックアップ'
    ];
    // ▲▲▲ 変更ここまで ▲▲▲
    // ===================================================================================

    kintone.events.on('app.record.create.submit', async (event) => {
      const record = event.record;
      const purchaserId = record[SOURCE_PURCHASER_ID_CODE].value;

      if (purchaserId) {
        return event;
      }

      console.log('Purchaser ID is blank. Starting new purchaser creation process...');

      try {
        // --- メインフィールド用のデータを作成 ---
        const newPurchaserRecord = {};
        FIELDS_TO_COPY.forEach(fieldCode => {
          if (record[fieldCode] && typeof record[fieldCode].value !== 'undefined' && record[fieldCode].value !== null) {
            newPurchaserRecord[fieldCode] = {
              value: record[fieldCode].value
            };
          }
        });

        // --- テーブル用のデータを作成 ---
        const tableRowValue = {};
        FIELDS_TO_COPY_INTO_TABLE.forEach(fieldCode => {
            if (record[fieldCode] && typeof record[fieldCode].value !== 'undefined' && record[fieldCode].value !== null) {
                // テーブル内のフィールドコードと、コピー元のフィールドコードが同じと仮定
                tableRowValue[fieldCode] = {
                    value: record[fieldCode].value
                };
            }
        });

        // テーブルに書き込むデータがある場合のみ、テーブルデータを追加
        if (Object.keys(tableRowValue).length > 0) {
            newPurchaserRecord[TARGET_TABLE_CODE] = {
                value: [ // テーブルは行の配列
                    {
                        value: tableRowValue // 1行分のデータ
                    }
                ]
            };
        }
        console.log('Data to be copied:', newPurchaserRecord);

        // 1. 【購入者情報】に新しいレコードを追加する
        const postResp = await kintone.api(kintone.api.url('/k/v1/record', true), 'POST', {
          app: TARGET_APP_ID,
          record: newPurchaserRecord
        });
        const newRecordId = postResp.id;
        console.log(`Created new purchaser record in App ${TARGET_APP_ID} with Record ID: ${newRecordId}`);

        // 2. 取得したレコード番号を元に、新しい顧客IDをこのスクリプト内で生成する
        const newPurchaserId = ID_PREFIX + String(newRecordId).padStart(PADDING_LENGTH, '0');
        console.log(`Generated new Purchaser ID: ${newPurchaserId}`);

        // 3. 生成したIDで、【購入者情報】の今作ったレコードを更新する
        await kintone.api(kintone.api.url('/k/v1/record', true), 'PUT', {
          app: TARGET_APP_ID,
          id: newRecordId,
          record: {
            [TARGET_PURCHASER_ID_CODE]: {
              value: newPurchaserId
            }
          }
        });
        console.log(`Successfully updated the new purchaser record with the generated ID.`);

        // 4. 生成したIDを、【決済管理表】のレコードにも書き戻す
        record[SOURCE_PURCHASER_ID_CODE].value = newPurchaserId;
        console.log(`New Purchaser ID has been set to the current record.`);

      } catch (error) {
        console.error('Error during new purchaser auto-creation process:', error);
        event.error = '新規顧客の自動登録中にエラーが発生しました。詳細はコンソールログを確認してください。 ' + error.message;
      }

      return event;
    });
  })();

})();

