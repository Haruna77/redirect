(function() {
  'use strict';

  // レコードの新規作成画面および編集画面で、保存実行前にイベントを発生させる
  kintone.events.on(['app.record.create.submit', 'app.record.edit.submit'], function(event) {
    const record = event.record;

    // ルックアップフィールドの値を取得
    const lookupValue = record['ルックアップ_購入商品'].value;

    // 値の存在チェックと型チェック
    // ルックアップフィールドの値がnullやundefined、または文字列型でない場合はエラーを回避する
    if (lookupValue && typeof lookupValue === 'string') {
      // ルックアップフィールドの値に「卸」が含まれているか判定
      if (lookupValue.includes('卸')) {
        // 含まれている場合、wholesale_flagフィールドに「卸」と入力
        record['wholesale_flag'].value = '卸';
      } else {
        // 含まれていない場合、wholesale_flagフィールドを空白にする
        record['wholesale_flag'].value = '';
      }
    } else {
      // ルックアップフィールドが空、または予期せぬ型の場合は、wholesale_flagフィールドを空白にする
      record['wholesale_flag'].value = '';
    }

    // イベントオブジェクトを返して、レコードの保存処理を続行する
    return event;
  });
})();
