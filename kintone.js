/**
 * Kintone Customization Script for 決済管理表
 * This script combines multiple functions including purchaser creation and all automations.
 */
(function() {
  'use strict';

  // --- 機能1: 購入商品に応じたフラグ設定 ------------------------------------
  (function() {
    const lookupFieldCode = 'ルックアップ_購入商品';
    const wholesaleFlagFieldCode = 'wholesale_flag';
    const giftFlagFieldCode = 'gift_flag';

    kintone.events.on(['app.record.create.submit', 'app.record.edit.submit'], function(event) {
      const record = event.record;
      if (!record[lookupFieldCode] || !record[lookupFieldCode].value) return event;
      const lookupValue = record[lookupFieldCode].value;
      record[wholesaleFlagFieldCode].value = '';
      record[giftFlagFieldCode].value = '';
      if (lookupValue.includes('卸')) record[wholesaleFlagFieldCode].value = '卸';
      if (lookupValue.includes('Amazonギフト券あり')) record[giftFlagFieldCode].value = 'Amazonギフトあり';
      return event;
    });
  })();

  // --- 機能2: 住所コピー機能 ------------------------------------------
  (function() {
    const checkboxFieldCode = 'チェックボックス_生徒住所と同じ';
    const sourcePostalCode = '郵便番号_生徒住所';
    const sourceName = '名前_生徒住所';
    const sourceAddress = '住所_生徒住所_0';
    const destPostalCode = '郵便番号_郵送先';
    const destName = '宛名_郵送先';
    const destAddress = '住所_郵送先';

    const events = [`app.record.create.change.${checkboxFieldCode}`, `app.record.edit.change.${checkboxFieldCode}`];
    kintone.events.on(events, function(event) {
      const record = event.record;
      const isChecked = record[checkboxFieldCode].value.length > 0;
      if (isChecked) {
        record[destPostalCode].value = record[sourcePostalCode].value;
        record[destName].value = record[sourceName].value;
        record[destAddress].value = record[sourceAddress].value;
      } else {
        record[destPostalCode].value = '';
        record[destName].value = '';
        record[destAddress].value = '';
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

    const FIELDS_TO_COPY = [
      '生徒名_苗字', '生徒名_名前', 'メールアドレス', 'phone', '名前_生徒住所',
      '郵便番号_生徒住所', '住所_生徒住所_0', '生徒LINE名', '文字列__1行_登録経路_手入力用',
      '文字列__1行_集客媒体_報酬ランク', '文字列__1行_集客者_手入力用', '集客者_ルックアップ',
      'ルックアップ_導線タイプ', 'ルックアップ_登録経路_自社広告・自社SNS', 'ルックアップ_集客媒体_集客者の報酬ランク',
      'ルックアップ_登録経路_集客者から選択', '報酬ランク_集客', '文字列_複数行_備考'
    ];
    const FIELDS_TO_COPY_INTO_TABLE = [
      '全額決済完了日', '決済残高', '文字列__1行_商品種別', 'ドロップダウン_解約理由',
      'ルックアップ_購入商品', 'クローザー_ルックアップ', 'ドロップダウン_ONE入会有無', '数値_商品単価'
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

        // ▼▼▼【機能追加】▼▼▼
        // 自動入力フィールドのロジックをここに追加
        // 1. 「ONE生徒」の自動入力
        const productTypeFieldCode = '文字列__1行_商品種別';
        if (record[productTypeFieldCode] && record[productTypeFieldCode].value && record[productTypeFieldCode].value.includes('バックエンド')) {
          newPurchaserRecord['自動入力_ONE入会有無'] = { value: 'ONE生徒' };
        }
        // 2. 「集客者」の自動入力
        const referrerPriority = ['集客者_ルックアップ', 'ルックアップ_登録経路_自社広告・自社SNS', '文字列__1行_登録経路_手入力用'];
        for (const fieldCode of referrerPriority) {
          if (record[fieldCode] && record[fieldCode].value) {
            newPurchaserRecord['自動入力_集客者'] = { value: record[fieldCode].value };
            break;
          }
        }
        // 3. 「集客媒体」の自動入力
        const mediaPriority = ['報酬ランク_集客', 'ルックアップ_集客媒体_集客者の報酬ランク'];
        for (const fieldCode of mediaPriority) {
          if (record[fieldCode] && record[fieldCode].value) {
            newPurchaserRecord['自動入力_集客媒体'] = { value: record[fieldCode].value };
            break;
          }
        }
        // ▲▲▲【機能追加ここまで】▲▲▲

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
      newPurchaserInfo = null;
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
        const targetRecord = getResp.records[0];
        const targetRecordId = targetRecord.$id.value;
        const targetTable = targetRecord[TARGET_TABLE_CODE].value;
        if (targetTable.length > 0) {
          const firstRow = targetTable[0];
          const updateDataValue = { ...firstRow.value };
          updateDataValue[TARGET_RECORD_NO_CODE] = { value: Number(record.$id.value) };
          updateDataValue[TARGET_CREATED_TIME_CODE] = { value: record.作成日時.value };
          await kintone.api(kintone.api.url('/k/v1/record', true), 'PUT', {
            app: TARGET_APP_ID,
            id: targetRecordId,
            record: {
              [TARGET_TABLE_CODE]: {
                value: [{ id: firstRow.id, value: updateDataValue }]
              }
            }
          });
          console.log(`機能4: Successfully updated purchaser record ${targetRecordId} with final info.`);
        }
      } catch (error) {
        console.error('機能4 Error:', error);
      }
      return event;
    });
  })();

})();

