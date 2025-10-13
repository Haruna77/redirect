/**
 * Kintone Customization Script for 決済管理表
 * This script combines multiple functions including purchaser creation, automations,
 * updating existing purchaser records on both record creation and edit,
 * and fetching purchaser info automatically when a purchaser ID is entered.
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
      'ルックアップ_登録経路_集客者から選択', '報酬ランク_集客'
    ];
    const FIELDS_TO_COPY_INTO_TABLE = [
      '全額決済完了日', '決済残高', '文字列__1行_商品種別', 'ドロップダウン_解約理由',
      'ルックアップ_購入商品', 'クローザー_ルックアップ', 'ドロップダウン_ONE入会有無', '数値_商品単価',
      '文字列_複数行_備考'
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
        const referrerPriority = ['集客者_ルックアップ', 'ルックアップ_登録経路_自社広告・自社SNS', '文字列__1行_登録経路_手入力用'];
        for (const fieldCode of referrerPriority) {
          if (record[fieldCode] && record[fieldCode].value) {
            newPurchaserRecord['自動入力_集客者'] = { value: record[fieldCode].value };
            break;
          }
        }
        const mediaPriority = ['報酬ランク_集客', 'ルックアップ_集客媒体_集客者の報酬ランク'];
        for (const fieldCode of mediaPriority) {
          if (record[fieldCode] && record[fieldCode].value) {
            newPurchaserRecord['自動入力_集客媒体'] = { value: record[fieldCode].value };
            break;
          }
        }
        const productTypeFieldCode = '文字列__1行_商品種別';
        if (record[productTypeFieldCode] && record[productTypeFieldCode].value && record[productTypeFieldCode].value.includes('バックエンド')) {
          newPurchaserRecord['自動入力_ONE入会有無'] = { value: 'ONE生徒' };
        }
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
        newPurchaserInfo = { purchaserId: newPurchaserId, isNew: true };
        console.log(`機能3: New Purchaser ID ${newPurchaserId} has been set.`);
      } catch (error) {
        console.error('機能3 Error:', error);
        event.error = '新規顧客の自動登録中にエラーが発生しました。 ' + error.message;
        newPurchaserInfo = null;
      }
      return event;
    });
  })();

  // --- 機能4 & 5: 保存後の情報更新（新規・既存両対応） ---------------------
  (function() {
    const TARGET_APP_ID = 26;
    const SOURCE_PURCHASER_ID_CODE = 'purchaser_id';
    const TARGET_PURCHASER_ID_CODE = 'purchaser_id';
    const TARGET_TABLE_CODE = 'テーブル_決済管理表の情報_購入履歴';
    const TARGET_RECORD_NO_CODE = 'レコード番号';
    const TARGET_CREATED_TIME_CODE = '作成日時';

    const FIELDS_TO_UPDATE = [
      'メールアドレス', 'phone', '名前_生徒住所',
      '郵便番号_生徒住所', '住所_生徒住所_0', '生徒LINE名'
    ];
    const FIELDS_FOR_NEW_ROW = [
       'ルックアップ_購入商品', '数値_商品単価', '全額決済完了日', '決済残高',
       'クローザー_ルックアップ', '文字列__1行_商品種別', 'ドロップダウン_解約理由', 'ドロップダウン_ONE入会有無',
       '文字列_複数行_備考'
    ];

    kintone.events.on('app.record.create.submit.success', async (event) => {
      const record = event.record;
      const purchaserId = record[SOURCE_PURCHASER_ID_CODE].value;
      if (!purchaserId) return event;

      if (newPurchaserInfo && newPurchaserInfo.isNew && newPurchaserInfo.purchaserId === purchaserId) {
        console.log(`機能4: Starting final info update for NEW purchaser ID: ${purchaserId}`);
        newPurchaserInfo = null;
        try {
          const getResp = await kintone.api(kintone.api.url('/k/v1/records', true), 'GET', { app: TARGET_APP_ID, query: `${TARGET_PURCHASER_ID_CODE} = "${purchaserId}"`, fields: ['$id', TARGET_TABLE_CODE] });
          if (getResp.records.length === 0) return event;
          const targetRecordId = getResp.records[0].$id.value;
          const targetTable = getResp.records[0][TARGET_TABLE_CODE].value;
          if (targetTable.length > 0) {
            const firstRow = targetTable[0];
            const updateDataValue = { ...firstRow.value };
            updateDataValue[TARGET_RECORD_NO_CODE] = { value: Number(record.$id.value) };
            updateDataValue[TARGET_CREATED_TIME_CODE] = { value: record.作成日時.value };
            await kintone.api(kintone.api.url('/k/v1/record', true), 'PUT', { app: TARGET_APP_ID, id: targetRecordId, record: { [TARGET_TABLE_CODE]: { value: [{ id: firstRow.id, value: updateDataValue }] } } });
            console.log(`機能4: Successfully updated new purchaser record ${targetRecordId} with final info.`);
          }
        } catch (error) { console.error('機能4 Error:', error); }

      } else {
        console.log(`機能5: Starting purchase history update for EXISTING purchaser ID: ${purchaserId}`);
        try {
          const getResp = await kintone.api(kintone.api.url('/k/v1/records', true), 'GET', { app: TARGET_APP_ID, query: `${TARGET_PURCHASER_ID_CODE} = "${purchaserId}"` });
          if (getResp.records.length === 0) return event;
          const targetRecord = getResp.records[0];
          const targetRecordId = targetRecord.$id.value;
          const recordForUpdate = {};
          FIELDS_TO_UPDATE.forEach(fc => {
            if (record[fc] && record[fc].value !== null && typeof record[fc].value !== 'undefined') recordForUpdate[fc] = { value: record[fc].value };
          });
          const newRowValue = {};
          FIELDS_FOR_NEW_ROW.forEach(fc => {
            if (record[fc] && record[fc].value !== null && typeof record[fc].value !== 'undefined') newRowValue[fc] = { value: record[fc].value };
          });
          newRowValue[TARGET_RECORD_NO_CODE] = { value: Number(record.$id.value) };
          newRowValue[TARGET_CREATED_TIME_CODE] = { value: record.作成日時.value };
          const existingTable = targetRecord[TARGET_TABLE_CODE].value;
          existingTable.push({ value: newRowValue });
          recordForUpdate[TARGET_TABLE_CODE] = { value: existingTable };
          await kintone.api(kintone.api.url('/k/v1/record', true), 'PUT', { app: TARGET_APP_ID, id: targetRecordId, record: recordForUpdate });
          console.log(`機能5: Successfully added new purchase history to purchaser record ${targetRecordId}.`);
        } catch (error) { console.error('機能5 Error:', error); }
      }
      return event;
    });
  })();

  // --- 機能6: 既存レコード編集時の情報更新 -----------------------------------
  (function() {
    const TARGET_APP_ID = 26;
    const SOURCE_PURCHASER_ID_CODE = 'purchaser_id';
    const TARGET_PURCHASER_ID_CODE = 'purchaser_id';
    const TARGET_TABLE_CODE = 'テーブル_決済管理表の情報_購入履歴';
    const SOURCE_RECORD_NO_FIELD_IN_TABLE = 'レコード番号';

    const FIELDS_TO_UPDATE_ON_EDIT = [
      '生徒名_苗字', '生徒名_名前', 'メールアドレス', 'phone', '名前_生徒住所',
      '郵便番号_生徒住所', '住所_生徒住所_0', '生徒LINE名', '集客者_ルックアップ',
      'ルックアップ_導線タイプ', '報酬ランク_集客', 'ルックアップ_登録経路_自社広告・自社SNS',
      'ルックアップ_集客媒体_集客者の報酬ランク', '文字列__1行_登録経路_手入力用'
    ];
    const FIELDS_TO_UPDATE_IN_TABLE_ON_EDIT = [
      'ルックアップ_購入商品', '数値_商品単価', '全額決済完了日', '決済残高',
      'クローザー_ルックアップ', '文字列__1行_商品種別', 'ドロップダウン_解約理由',
      'ドロップダウン_ONE入会有無', '文字列_複数行_備考'
    ];

    kintone.events.on('app.record.edit.submit.success', async (event) => {
      const record = event.record;
      const purchaserId = record[SOURCE_PURCHASER_ID_CODE].value;
      const sourceRecordId = Number(record.$id.value);
      if (!purchaserId) return event;
      console.log(`機能6: Starting update for edited record. Purchaser ID: ${purchaserId}, Source Record ID: ${sourceRecordId}`);
      try {
        const getResp = await kintone.api(kintone.api.url('/k/v1/records', true), 'GET', { app: TARGET_APP_ID, query: `${TARGET_PURCHASER_ID_CODE} = "${purchaserId}"` });
        if (getResp.records.length === 0) return event;
        const targetRecord = getResp.records[0];
        const targetRecordId = targetRecord.$id.value;
        const recordForUpdate = {};
        FIELDS_TO_UPDATE_ON_EDIT.forEach(fc => {
          if (record[fc] && record[fc].value !== null && typeof record[fc].value !== 'undefined') recordForUpdate[fc] = { value: record[fc].value };
        });
        const table = targetRecord[TARGET_TABLE_CODE].value;
        let rowIndex = -1;
        for (let i = 0; i < table.length; i++) {
          const rowRecordNo = table[i].value[SOURCE_RECORD_NO_FIELD_IN_TABLE].value;
          if (Number(rowRecordNo) === sourceRecordId) {
            rowIndex = i;
            break;
          }
        }
        if (rowIndex !== -1) {
          const updatedRowValue = { ...table[rowIndex].value };
          FIELDS_TO_UPDATE_IN_TABLE_ON_EDIT.forEach(fc => {
            if (record[fc] && record[fc].value !== null && typeof record[fc].value !== 'undefined') updatedRowValue[fc] = { value: record[fc].value };
          });
          table[rowIndex].value = updatedRowValue;
          recordForUpdate[TARGET_TABLE_CODE] = { value: table };
        }
        if (Object.keys(recordForUpdate).length > 0) {
          await kintone.api(kintone.api.url('/k/v1/record', true), 'PUT', { app: TARGET_APP_ID, id: targetRecordId, record: recordForUpdate });
          console.log(`機能6: Successfully updated purchaser record ${targetRecordId}.`);
        }
      } catch (error) { console.error('機能6 Error:', error); }
      return event;
    });
  })();

  // --- 機能7: 顧客ID入力時の自動情報取得 --------------------------------
  (function() {
    const TARGET_APP_ID = 26;
    const TRIGGER_FIELD = 'purchaser_id';

    const FIELDS_TO_FETCH_MAP = {
      '生徒名_苗字': '生徒名_苗字', '生徒名_名前': '生徒名_名前', 'メールアドレス': 'メールアドレス',
      'phone': 'phone', '名前_生徒住所': '名前_生徒住所', '郵便番号_生徒住所': '郵便番号_生徒住所',
      '住所_生徒住所_0': '住所_生徒住所_0', '生徒LINE名': '生徒LINE名'
    };

    const events = [`app.record.create.change.${TRIGGER_FIELD}`, `app.record.edit.change.${TRIGGER_FIELD}`];
    kintone.events.on(events, async (event) => {
      const record = event.record;
      const purchaserId = record[TRIGGER_FIELD].value;
      const fieldsToClear = Object.keys(FIELDS_TO_FETCH_MAP);
      if (!purchaserId) {
        fieldsToClear.forEach(fieldCode => { if (record[fieldCode]) record[fieldCode].value = ''; });
        kintone.app.record.set(event);
        return event;
      }
      console.log(`機能7: Fetching data for Purchaser ID: ${purchaserId}`);
      try {
        const resp = await kintone.api(kintone.api.url('/k/v1/records', true), 'GET', { app: TARGET_APP_ID, query: `purchaser_id = "${purchaserId}" limit 1`, fields: Object.values(FIELDS_TO_FETCH_MAP) });
        if (resp.records.length > 0) {
          const sourceRecord = resp.records[0];
          for (const [destField, sourceField] of Object.entries(FIELDS_TO_FETCH_MAP)) {
            if (record[destField] && sourceRecord[sourceField] && typeof sourceRecord[sourceField].value !== 'undefined') {
              record[destField].value = sourceRecord[sourceField].value;
            }
          }
        } else {
          fieldsToClear.forEach(fieldCode => { if (record[fieldCode]) record[fieldCode].value = ''; });
        }
        kintone.app.record.set(event);
      } catch (error) { console.error('機能7 Error:', error); }
      return event;
    });
  })();

})();

