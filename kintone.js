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

  // --- 機能3: 新規顧客の自動登録とID生成 (保存前) ----------------------------
  /**
   * @name New Purchaser Auto-Creation & ID Generation (Before Save)
   */
  (function() {
    // ===================================================================================
    // 設定箇所 (User Configuration)
    // ===================================================================================
    const TARGET_APP_ID = 26;
    const SOURCE_PURCHASER_ID_CODE = 'purchaser_id';
    const TARGET_PURCHASER_ID_CODE = 'purchaser_id';
    const ID_PREFIX = 'C-';
    const PADDING_LENGTH = 7;
    const TARGET_TABLE_CODE = 'テーブル_決済管理表の情報_購入履歴';

    const FIELDS_TO_COPY = [
      '生徒名_苗字', '生徒名_名前', 'メールアドレス', 'phone', '名前_生徒住所',
      '郵便番号_生徒住所', '住所_生徒住所_0', '生徒LINE名', '文字列__1行_登録経路_手入力用',
      '文字列__1行_集客媒体_報酬ランク', '文字列__1行_集客者_手入力用'
    ];

    const FIELDS_TO_COPY_INTO_TABLE = [
      '全額決済完了日', '決済残高', '文字列__1行_商品種別', 'ドロップダウン_解約理由',
      'ルックアップ_購入商品', 'クローザー_ルックアップ'
    ];
    // ===================================================================================

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
        console.log(`機能3: New Purchaser ID ${newPurchaserId} has been set.`);
      } catch (error) {
        console.error('機能3 Error:', error);
        event.error = '新規顧客の自動登録中にエラーが発生しました。 ' + error.message;
      }
      return event;
    });
  })();

  // --- 機能4: 保存後の情報追記 (レコード番号と作成日時) ---------------------
  /**
   * @name Update Purchaser with Final Info (After Save)
   */
  (function() {
    // ===================================================================================
    // 設定箇所 (User Configuration)
    // ===================================================================================
    const TARGET_APP_ID = 26;
    const SOURCE_PURCHASER_ID_CODE = 'purchaser_id';
    const TARGET_PURCHASER_ID_CODE = 'purchaser_id';
    const TARGET_TABLE_CODE = 'テーブル_決済管理表の情報_購入履歴';

    // ★要設定: 【購入者情報】のテーブル内にある、コピー先のフィールドコード
    const TARGET_RECORD_NO_CODE = 'レコード番号';      // 例：決済管理表レコード番号
    const TARGET_CREATED_TIME_CODE = '作成日時'; // 例：決済管理表作成日時
    // ===================================================================================

    kintone.events.on('app.record.create.submit.success', async (event) => {
      const record = event.record;
      const purchaserId = record[SOURCE_PURCHASER_ID_CODE].value;

      // 新規作成された顧客の場合のみ実行 (purchaserIdが空でなく、かつisNewCustomerフラグが立っている)
      // isNewCustomerフラグは、機能3で新規作成された場合にのみ一時的に存在する想定
      if (!purchaserId || !event.record.isNewCustomer) {
         // 簡単なチェックとして、purchaserIdが空でなければOKとする
         if(!purchaserId) return event;
      }
      
      // event.record.isNewCustomer = false; // フラグをリセット

      console.log(`機能4: Updating final info for new purchaser ID: ${purchaserId}`);

      try {
        // 1. purchaserId を元に、【購入者情報】のレコードIDを取得する
        const getResp = await kintone.api(kintone.api.url('/k/v1/records', true), 'GET', {
          app: TARGET_APP_ID,
          query: `${TARGET_PURCHASER_ID_CODE} = "${purchaserId}"`,
          fields: ['$id', TARGET_TABLE_CODE]
        });

        if (getResp.records.length === 0) {
          console.error(`機能4 Error: Could not find purchaser record with ID ${purchaserId}`);
          return event;
        }

        const targetRecord = getResp.records[0];
        const targetRecordId = targetRecord.$id.value;
        const targetTable = targetRecord[TARGET_TABLE_CODE].value;

        // テーブルの最初の行を更新する
        if (targetTable.length > 0) {
          const firstRowId = targetTable[0].id;
          const updateData = {
              id: firstRowId,
              value: {
                  [TARGET_RECORD_NO_CODE]: { value: event.recordId }, // 保存後のレコード番号
                  [TARGET_CREATED_TIME_CODE]: { value: record.作成日時.value } // 保存後の作成日時
              }
          };

          // 既存のテーブル行の値を保持
          Object.assign(updateData.value, targetTable[0].value);

          // 2. 【購入者情報】のレコードを更新して、テーブルに情報を追記する
          await kintone.api(kintone.api.url('/k/v1/record', true), 'PUT', {
            app: TARGET_APP_ID,
            id: targetRecordId,
            record: {
              [TARGET_TABLE_CODE]: {
                value: [updateData]
              }
            }
          });
          console.log(`機能4: Successfully updated purchaser record ${targetRecordId} with final info.`);
        }
      } catch (error) {
        console.error('機能4 Error:', error);
        // ここでは画面にエラーを表示しない（メインの保存は成功しているため）
      }
      return event;
    });

    // 新規顧客作成時のみ機能4を動かすためのフラグ設定
    kintone.events.on('app.record.create.submit', (event) => {
        if (!event.record[SOURCE_PURCHASER_ID_CODE].value) {
            event.record.isNewCustomer = {value: true}; // 見えないフィールドにフラグを立てる
        }
        return event;
    });

  })();

})();

