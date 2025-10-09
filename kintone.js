/**
 * Kintone Customization Script for 決済管理表
 * This script combines four functions:
 * 1. Sets flags based on the purchased product.
 * 2. Copies address details based on a checkbox.
 * 3. On create.submit, automatically creates a new purchaser record if the purchaser ID is blank.
 * 4. On create.submit.success, updates the newly created purchaser record with the source record's ID and timestamp.
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
    const destName          = '宛名_郵- D郵送先';
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

  // グローバルスコープに一時的な変数を保持
  let newPurchaserInfo = null;

  // --- 機能3: 新規顧客の自動登録とID生成 (保存前) ----------------------------
  (function() {
    const TARGET_APP_ID = 26;
    const SOURCE_PURCHASER_ID_CODE = 'purchaser_id';
    const TARGET_PURCHASER_ID_CODE = 'purchaser_id';
    const ID_PREFIX = 'C-';
    const PADDING_LENGTH = 7;
    const TARGET_TABLE_CODE = 'テーブル_決済管理表の情報_購入履歴';

    // テーブルの外にあるフィールドをコピーするためのリスト
    const FIELDS_TO_COPY = [
      '生徒名_苗字', '生徒名_名前', 'メールアドレス', 'phone', '名前_生徒住所',
      '郵便番号_生徒住所', '住所_生徒住所_0', '生徒LINE名', '文字列__1行_登録経路_手入力用',
      '文字列__1行_集客媒体_報酬ランク', '文字列__1行_集客者_手入力用',
      '集客者_ルックアップ',
      'ルックアップ_導線タイプ',
      'ルックアップ_登録経路_自社広告・自社SNS',
      'ルックアップ_集客媒体_集客者の報酬ランク',
      'ルックアップ_登録経路_集客者から選択',
      '報酬ランク_集客',
      '文字列_複数行_備考' // ←★追加しました
    ];
    // テーブルの中にコピーするためのリスト
    const FIELDS_TO_COPY_INTO_TABLE = [
      '全額決済完了日', '決済残高', '文字列__1行_商品種別', 'ドロップダウン_解約理由',
      'ルックアップ_購入商品', 'クローザー_ルックアップ',
      'ドロップダウン_ONE入会有無',
      '数値_商品単価'
    ];

    kintone.events.on('app.record.create.submit', async (event) => {
      const record = event.record;
      if (record[SOURCE_PURCHASER_ID_CODE].value) {
        return event;
      }
      console.log('機能3: Starting new purchaser creation process...');
      try {
        const newPurchaserRecord = {};
        FIELDS_TO_COPY.forEach(fc => {
          if (record[fc] && record[fc].value !== null && typeof record[fc].value !== 'undefined') newPurchaserRecord[fc] = { value: record[fc].value };
        });
        const tableRowValue = {};
        FIELDS_TO_COPY_INTO_TABLE.forEach(fc => {
          if (record[fc] && record[fc].value !== null && typeof record[fc].value !== 'undefined') tableRowValue[fc] = { value: record[fc].value };
        });
        if (Object.keys(tableRowValue).length > 0) {
          newPurchaserRecord[TARGET_TABLE_CODE] = { value: [{ value: tableRowValue }] };
        }

        const postResp = await kintone.api(kintone.api.url('/k/v1/record', true), 'POST', { app: TARGET_APP_ID, record: newPurchaserRecord });
        const newRecordId = postResp.id;
        const newPurchaserId = ID_PREFIX + String(newRecordId).padStart(PADDING_LENGTH, '0');

        await kintone.api(kintone.api.url('/k/v1/record', true), 'PUT', { app: TARGET_APP_ID, id: newRecordId, record: { [TARGET_PURCHASER_ID_CODE]: { value: newPurchaserId } } });
        record[SOURCE_PURCHASER_ID_CODE].value = newPurchaserId;

        // 機能4に情報を渡すために、一時的に保存
        newPurchaserInfo = { purchaserId: newPurchaserId };
        
        console.log(`機能3: New Purchaser ID ${newPurchaserId} has been set.`);
      } catch (error) {
        console.error('機能3 Error:', error);
        event.error = '新規顧客の自動登録中にエラーが発生しました。 ' + error.message;
        newPurchaserInfo = null;
      }
      return event;
    });
  })();

  // --- 機能4: 保存後の情報追記 (レコード番号と作成日時) ---------------------
  (function() {
    const TARGET_APP_ID = 26;
    const TARGET_PURCHASER_ID_CODE = 'purchaser_id';
    const TARGET_TABLE_CODE = 'テーブル_決済管理表の情報_購入履歴';
    const TARGET_RECORD_NO_CODE = 'レコード番号';
    const TARGET_CREATED_TIME_CODE = '作成日時';

    kintone.events.on('app.record.create.submit.success', async (event) => {
      console.log('機能4: submit.success イベントが発火しました。');

      if (!newPurchaserInfo) {
        console.log('機能4: 新規顧客情報がないため、処理をスキップします。');
        return event;
      }

      const record = event.record;
      const purchaserId = newPurchaserInfo.purchaserId;
      newPurchaserInfo = null; // 情報をクリア

      console.log(`機能4: Starting final info update for new purchaser ID: ${purchaserId}`);

      try {
        const getResp = await kintone.api(kintone.api.url('/k/v1/records', true), 'GET', {
          app: TARGET_APP_ID,
          query: `${TARGET_PURCHASER_ID_CODE} = "${purchaserId}"`,
          fields: ['$id', TARGET_TABLE_CODE]
        });

        if (getResp.records.length === 0) {
          console.error(`機能4 Error: Could not find purchaser record with ID ${purchaserId}`);
          return event;
        }
        console.log('機能4: 対象の購入者レコードを発見しました。');

        const targetRecord = getResp.records[0];
        const targetRecordId = targetRecord.$id.value;
        const targetTable = targetRecord[TARGET_TABLE_CODE].value;

        if (targetTable.length > 0) {
          const firstRow = targetTable[0];
          const updateDataValue = { ...firstRow.value };

          // レコード番号を「数値」に変換して、型の不一致を防ぎます。
          updateDataValue[TARGET_RECORD_NO_CODE] = { value: Number(record.$id.value) };
           
          updateDataValue[TARGET_CREATED_TIME_CODE] = { value: record.作成日時.value };

          console.log('機能4: 追記するデータ:', {recordNo: Number(record.$id.value), createdTime: record.作成日時.value});

          await kintone.api(kintone.api.url('/k/v1/record', true), 'PUT', {
            app: TARGET_APP_ID,
            id: targetRecordId,
            record: {
              [TARGET_TABLE_CODE]: {
                value: [{
                  id: firstRow.id,
                  value: updateDataValue
                }]
              }
            }
          });
          console.log(`機能4: Successfully updated purchaser record ${targetRecordId} with final info.`);
        } else {
           console.log('機能4: 対象レコードにテーブル行が存在しなかったため、更新をスキップしました。');
        }
      } catch (error) {
        console.error('機能4 Error:', error);
      }
      return event;
    });
  })();

})();

