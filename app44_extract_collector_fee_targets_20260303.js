/**
 * App 44: 集客者フィー 発行管理 - 対象者抽出 + App 36 レコード作成 JSカスタマイズ
 *
 * 一覧画面の「対象者を抽出」ボタンで、全期間の未請求/未反映データを
 * 集客者×請求先で集計し、App 44を洗い替えする。
 * 「集客者請求書作成」ボタンで App 36 にレコードを一括作成する。
 *
 * 必要なAPIトークン権限（APIトークン認証の場合）:
 *   App 44: レコード閲覧・追加・編集・削除
 *   App 29: レコード閲覧
 *   App 39: レコード閲覧
 *   App 15: レコード閲覧
 *   App 36: レコード追加
 * ※ ログインユーザー認証で動作する場合、上記アプリへのアクセス権があればOK
 */
(function () {
  'use strict';

  // ── 設定 ──────────────────────────────────────────────────
  var APP29_ID = 29; // 決済管理表
  var APP39_ID = 39; // 返金管理
  var APP15_ID = 15; // 集客者マスタ
  var APP44_ID = 44; // 集客者フィー 発行管理（このアプリ）
  var APP36_ID = 36; // 集客者請求書

  var CHATWORK_TOKEN = 'b246dc819ddfe852338282307ab13582';
  var CHATWORK_ROOM_ID = '423441201';

  var PRODUCT_TO_COMPANY = {
    '🟦AI': '株式会社AI ONE',
    '🟩物販': '株式会社物販ONE'
  };

  var COMPANY_TO_PRODUCT = {
    '株式会社AI ONE': '🟦AI',
    '株式会社物販ONE': '🟩物販'
  };

  // ── ユーティリティ ────────────────────────────────────────
  function getPreviousMonth() {
    var now = new Date();
    var y = now.getFullYear();
    var m = now.getMonth(); // 0-indexed, so this is already "previous month"
    if (m === 0) { y--; m = 12; }
    return y + '-' + ('0' + m).slice(-2);
  }

  /** 当月初日を返す（例: "2026-03-01"）― これより前のデータのみ対象 */
  function getCurrentMonthStart() {
    var now = new Date();
    var y = now.getFullYear();
    var m = now.getMonth() + 1;
    return y + '-' + ('0' + m).slice(-2) + '-01';
  }

  /** 今日の日付を YYYY-MM-DD で返す */
  function getCurrentDateString() {
    var now = new Date();
    var y = now.getFullYear();
    var m = ('0' + (now.getMonth() + 1)).slice(-2);
    var d = ('0' + now.getDate()).slice(-2);
    return y + '-' + m + '-' + d;
  }

  /**
   * kintone REST API でレコードを全件取得（ページネーション対応）
   */
  function fetchAllRecords(appId, query, fields) {
    var allRecords = [];
    var limit = 500;

    function fetchPage(offset) {
      var params = {
        app: appId,
        query: query + ' limit ' + limit + ' offset ' + offset
      };
      if (fields && fields.length > 0) {
        params.fields = fields;
      }
      return kintone.api(kintone.api.url('/k/v1/records', true), 'GET', params)
        .then(function (resp) {
          allRecords = allRecords.concat(resp.records);
          if (resp.records.length === limit) {
            return fetchPage(offset + limit);
          }
          return allRecords;
        });
    }

    return fetchPage(0);
  }

  /**
   * レコードを一括削除（100件ずつ）
   */
  function deleteAllRecords(appId, ids) {
    if (ids.length === 0) return Promise.resolve(0);

    var batches = [];
    for (var i = 0; i < ids.length; i += 100) {
      batches.push(ids.slice(i, i + 100));
    }

    return batches.reduce(function (promise, batch) {
      return promise.then(function (total) {
        return kintone.api(kintone.api.url('/k/v1/records', true), 'DELETE', {
          app: appId,
          ids: batch
        }).then(function () {
          return total + batch.length;
        });
      });
    }, Promise.resolve(0));
  }

  /**
   * レコードを一括作成（100件ずつ）
   */
  function createRecords(appId, records) {
    if (records.length === 0) return Promise.resolve(0);

    var batches = [];
    for (var i = 0; i < records.length; i += 100) {
      batches.push(records.slice(i, i + 100));
    }

    return batches.reduce(function (promise, batch) {
      return promise.then(function (total) {
        return kintone.api(kintone.api.url('/k/v1/records', true), 'POST', {
          app: appId,
          records: batch
        }).then(function () {
          return total + batch.length;
        });
      });
    }, Promise.resolve(0));
  }

  // ── 対象者抽出メイン処理 ────────────────────────────────────

  /**
   * Step 1: App 29 から全期間の未請求売上を取得（集客フィー > 0）
   */
  function fetchSales() {
    var cutoff = getCurrentMonthStart();
    var query =
      '全額決済完了日 != ""' +
      ' and 全額決済完了日 < "' + cutoff + '"' +
      ' and 請求済_集客者フィー全額 not in ("請求済（集客者フィー全額）")' +
      ' and 計算_集客フィー税抜 > "0"';
    var fields = ['集客者_ルックアップ', 'ドロップダウン_商品の種類'];
    return fetchAllRecords(APP29_ID, query, fields);
  }

  /**
   * Step 2: App 39 から全期間の未反映返金を取得（集客フィー > 0）
   */
  function fetchRefunds() {
    var cutoff = getCurrentMonthStart();
    var query =
      '日付_返金日 != ""' +
      ' and 日付_返金日 < "' + cutoff + '"' +
      ' and チェックボックス_集客者フィー相殺 not in ("反映済（集客者フィー）")' +
      ' and 数値_集客者フィー_税抜 > "0"';
    var fields = ['文字列__1行_集客者', '文字列__1行_商品の種類'];
    return fetchAllRecords(APP39_ID, query, fields);
  }

  /**
   * Step 3: App 15 から全集客者 + インボイス情報を一括取得
   */
  function fetchCollectorInfo() {
    var query = 'order by レコード番号 asc';
    var fields = ['名前_集客者', '文字列__1行_インボイス登録番号', '集客者種別_0'];
    return fetchAllRecords(APP15_ID, query, fields).then(function (records) {
      var result = {};
      records.forEach(function (rec) {
        var name = (rec['名前_集客者'] || {}).value || '';
        var invoice = ((rec['文字列__1行_インボイス登録番号'] || {}).value || '').trim();
        var collectorType = (rec['集客者種別_0'] || {}).value || '';
        if (name) {
          result[name] = {
            hasInvoice: invoice ? 'あり' : 'なし',
            invoiceNumber: invoice,
            collectorType: collectorType
          };
        }
      });
      return result;
    });
  }

  /**
   * Step 4: 集客者×請求先でユニーク集計（App 15に登録済みの集客者のみ）
   */
  function aggregate(salesRecords, refundRecords, collectorInfo) {
    var result = {};

    salesRecords.forEach(function (rec) {
      var collector = ((rec['集客者_ルックアップ'] || {}).value || '').trim();
      var product = (rec['ドロップダウン_商品の種類'] || {}).value || '';
      var company = PRODUCT_TO_COMPANY[product];
      if (!collector || !company) return;
      if (!collectorInfo[collector]) return; // App 15未登録 → スキップ

      var key = collector + '|||' + company;
      if (!result[key]) result[key] = { collector: collector, company: company, sales: 0, refunds: 0 };
      result[key].sales++;
    });

    refundRecords.forEach(function (rec) {
      var collector = ((rec['文字列__1行_集客者'] || {}).value || '').trim();
      var product = (rec['文字列__1行_商品の種類'] || {}).value || '';
      var company = PRODUCT_TO_COMPANY[product];
      if (!collector || !company) return;
      if (!collectorInfo[collector]) return;

      var key = collector + '|||' + company;
      if (!result[key]) result[key] = { collector: collector, company: company, sales: 0, refunds: 0 };
      result[key].refunds++;
    });

    return Object.keys(result).map(function (key) { return result[key]; });
  }

  /**
   * Step 5: App 44 用レコードデータを組み立て
   */
  function buildRecords(aggregated, collectorInfo, targetMonth) {
    return aggregated.map(function (item) {
      var info = collectorInfo[item.collector] || {};
      return {
        collector_name: { value: item.collector },
        target_month_date: { value: targetMonth + '-01' },
        billing_company: { value: item.company },
        sales_count: { value: String(item.sales) },
        refund_count: { value: String(item.refunds) },
        has_invoice: { value: info.hasInvoice || '確認中' },
        has_refund: { value: item.refunds > 0 ? 'あり' : 'なし' },
        collector_type: { value: info.collectorType || '' },
        status: { value: '未作成' }
      };
    });
  }

  /**
   * Step 6: Chatwork通知（抽出結果）
   */
  function notifyChatwork(records, targetMonth) {
    var lines = [
      '[info][title]集客者フィー 対象者抽出完了（' + targetMonth + '請求）[/title]',
      '対象者: ' + records.length + ' 件（全期間の未請求を合算）',
      ''
    ];
    records.sort(function (a, b) {
      return a.collector_name.value.localeCompare(b.collector_name.value);
    });
    records.forEach(function (rec) {
      lines.push(
        '・' + rec.collector_name.value +
        '（' + rec.billing_company.value + '）' +
        '売上' + rec.sales_count.value + '件 返金' + rec.refund_count.value + '件'
      );
    });
    lines.push('[/info]');

    var body = 'body=' + encodeURIComponent(lines.join('\n'));
    var url = 'https://api.chatwork.com/v2/rooms/' + CHATWORK_ROOM_ID + '/messages';
    var headers = { 'X-ChatWorkToken': CHATWORK_TOKEN, 'Content-Type': 'application/x-www-form-urlencoded' };

    return kintone.proxy(url, 'POST', headers, body)
      .then(function (args) {
        var statusCode = args[1];
        if (statusCode === 200) {
          console.log('Chatwork通知: 送信完了');
        } else {
          console.warn('Chatwork通知: 送信失敗 (' + statusCode + ')');
        }
      })
      .catch(function (e) {
        console.warn('Chatwork通知: エラー', e);
      });
  }

  /**
   * 全体フロー実行（対象者抽出）
   */
  function runExtraction() {
    var targetMonth = getPreviousMonth();

    var msg = '全期間の未請求・未反映データを集計して\n' +
              'App 44 のレコードを洗い替えします。\n\n' +
              '請求月: ' + targetMonth + '\n\n' +
              '実行しますか？';
    if (!confirm(msg)) return;

    // 処理中表示
    var overlay = document.createElement('div');
    overlay.id = 'billing-overlay';
    overlay.style.cssText =
      'position:fixed;top:0;left:0;width:100%;height:100%;' +
      'background:rgba(0,0,0,0.5);z-index:10000;display:flex;' +
      'align-items:center;justify-content:center;';
    overlay.innerHTML =
      '<div style="background:#fff;padding:40px 60px;border-radius:8px;text-align:center;">' +
      '<p style="font-size:18px;font-weight:bold;">処理中...</p>' +
      '<p id="billing-status" style="color:#666;margin-top:10px;">データ取得中</p></div>';
    document.body.appendChild(overlay);

    function updateStatus(text) {
      var el = document.getElementById('billing-status');
      if (el) el.textContent = text;
    }

    var collectorInfo, salesRecords, refundRecords;

    updateStatus('データ取得中...');
    Promise.all([
      fetchSales(),
      fetchRefunds(),
      fetchCollectorInfo()
    ])
      .then(function (results) {
        salesRecords = results[0];
        refundRecords = results[1];
        collectorInfo = results[2];

        updateStatus(
          'App 29: ' + salesRecords.length + '件, ' +
          'App 39: ' + refundRecords.length + '件, ' +
          'App 15: ' + Object.keys(collectorInfo).length + '名'
        );

        // 集計
        var aggregated = aggregate(salesRecords, refundRecords, collectorInfo);

        if (aggregated.length === 0) {
          throw new Error('対象データがありませんでした。');
        }

        var recordsToCreate = buildRecords(aggregated, collectorInfo, targetMonth);

        // 既存レコード取得→削除→新規作成
        updateStatus('App 44 既存レコード取得中...');
        return fetchAllRecords(APP44_ID, 'order by レコード番号 asc', ['$id'])
          .then(function (existing) {
            var ids = existing.map(function (r) { return r['$id'].value; });
            if (ids.length > 0) {
              updateStatus('App 44: ' + ids.length + '件 削除中...');
              return deleteAllRecords(APP44_ID, ids);
            }
            return 0;
          })
          .then(function (deletedCount) {
            updateStatus('App 44: ' + recordsToCreate.length + '件 作成中...');
            return createRecords(APP44_ID, recordsToCreate).then(function (createdCount) {
              return { deleted: deletedCount, created: createdCount, records: recordsToCreate };
            });
          });
      })
      .then(function (result) {
        updateStatus('Chatwork通知中...');
        return notifyChatwork(result.records, targetMonth).then(function () {
          return result;
        });
      })
      .then(function (result) {
        if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
        alert(
          '対象者抽出が完了しました。\n\n' +
          '削除: ' + result.deleted + '件\n' +
          '作成: ' + result.created + '件\n' +
          '（売上 ' + salesRecords.length + '件 + 返金 ' + refundRecords.length + '件 を集計）\n\n' +
          'Chatwork通知済み'
        );
        location.reload();
      })
      .catch(function (err) {
        if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
        alert('エラーが発生しました:\n' + (err.message || JSON.stringify(err)));
        console.error(err);
      });
  }

  // ── App 36 レコード一括作成 ─────────────────────────────────

  /**
   * App 44 の status="未作成" レコードを取得
   */
  function fetchApp44UnprocessedRecords() {
    var query = 'status in ("未作成") order by レコード番号 asc';
    return fetchAllRecords(APP44_ID, query, ['$id', 'レコード番号', 'collector_name', 'billing_company']);
  }

  /**
   * App 29 売上データ（サブテーブル用の全フィールド）取得
   */
  function fetchSalesForApp36() {
    var cutoff = getCurrentMonthStart();
    var query =
      '全額決済完了日 != ""' +
      ' and 全額決済完了日 < "' + cutoff + '"' +
      ' and 請求済_集客者フィー全額 not in ("請求済（集客者フィー全額）")' +
      ' and 計算_集客フィー税抜 > "0"';
    var fields = [
      '$id', '集客者_ルックアップ', 'ドロップダウン_商品の種類',
      'ルックアップ_購入商品', '計算_集客フィー税抜', '全額決済完了日',
      '生徒名_苗字', '生徒名_名前', '生徒LINE名',
      '計算_卸プレゼント5万円着金額_計算用', '決済額_振込', '決済額_クレカ', '決済額_信販',
      'ルックアップ_登録経路_自社広告・自社SNS_0'
    ];
    return fetchAllRecords(APP29_ID, query, fields);
  }

  /**
   * App 39 返金データ（サブテーブル用の全フィールド）取得
   */
  function fetchRefundsForApp36() {
    var cutoff = getCurrentMonthStart();
    var query =
      '日付_返金日 != ""' +
      ' and 日付_返金日 < "' + cutoff + '"' +
      ' and チェックボックス_集客者フィー相殺 not in ("反映済（集客者フィー）")' +
      ' and 数値_集客者フィー_税抜 > "0"';
    var fields = [
      '$id', '文字列__1行_集客者', '文字列__1行_商品の種類',
      '文字列__1行_購入商品', 'gatherer_offset_final', '日付_返金日',
      '文字列__1行_生徒名_苗字', '文字列__1行_生徒名_名前', '文字列__1行_生徒LINE名'
    ];
    return fetchAllRecords(APP39_ID, query, fields);
  }

  /**
   * 集計期間を算出（請求書発行日の前月1日〜末日）
   */
  function calculatePeriod(dateStr) {
    var date = new Date(dateStr);
    var firstDay = new Date(date.getFullYear(), date.getMonth() - 1, 1);
    var lastDay = new Date(date.getFullYear(), date.getMonth(), 0);
    function fmt(d) {
      var y = d.getFullYear();
      var m = ('0' + (d.getMonth() + 1)).slice(-2);
      var dd = ('0' + d.getDate()).slice(-2);
      return y + '-' + m + '-' + dd;
    }
    return fmt(firstDay) + ' 〜 ' + fmt(lastDay);
  }

  /**
   * collector×company でフィルタしてサブテーブル行を構築
   */
  function buildSubtableRows(collector, company, sales, refunds) {
    var targetType = COMPANY_TO_PRODUCT[company];
    if (!targetType) return [];

    var rows = [];

    // 売上行
    sales.forEach(function (r) {
      var rCollector = ((r['集客者_ルックアップ'] || {}).value || '').trim();
      var rType = (r['ドロップダウン_商品の種類'] || {}).value || '';
      if (rCollector !== collector || rType !== targetType) return;

      rows.push({
        value: {
          sub_date: { type: 'DATE', value: r['全額決済完了日'].value },
          sub_item: { type: 'SINGLE_LINE_TEXT', value: (r['ルックアップ_購入商品'] || {}).value || '' },
          sub_amount: { type: 'NUMBER', value: (r['計算_集客フィー税抜'] || {}).value || 0 },
          '文字列__1行_生徒さん苗字': { type: 'SINGLE_LINE_TEXT', value: (r['生徒名_苗字'] || {}).value || '' },
          '文字列__1行_生徒さん名前': { type: 'SINGLE_LINE_TEXT', value: (r['生徒名_名前'] || {}).value || '' },
          '文字列__1行_生徒さんLINE名': { type: 'SINGLE_LINE_TEXT', value: (r['生徒LINE名'] || {}).value || '' },
          '数量': { type: 'NUMBER', value: 1 },
          '数値_着金額': { type: 'NUMBER', value: (r['計算_卸プレゼント5万円着金額_計算用'] || {}).value || 0 },
          '数値_決済額_振込': { type: 'NUMBER', value: (r['決済額_振込'] || {}).value || 0 },
          '数値_決済額_クレカ': { type: 'NUMBER', value: (r['決済額_クレカ'] || {}).value || 0 },
          '数値_決済額_信販': { type: 'NUMBER', value: (r['決済額_信販'] || {}).value || 0 },
          '文字列__1行_今回成約の登録経路': { type: 'SINGLE_LINE_TEXT', value: (r['ルックアップ_登録経路_自社広告・自社SNS_0'] || {}).value || '' },
          '文字列__1行_レコード番号': { type: 'SINGLE_LINE_TEXT', value: 'sales-' + r['$id'].value }
        }
      });
    });

    // 返金行
    refunds.forEach(function (r) {
      var rCollector = ((r['文字列__1行_集客者'] || {}).value || '').trim();
      var rType = (r['文字列__1行_商品の種類'] || {}).value || '';
      if (rCollector !== collector || rType !== targetType) return;

      var amount = Number((r['gatherer_offset_final'] || {}).value) || 0;
      var minusAmount = amount * -1;

      rows.push({
        value: {
          sub_date: { type: 'DATE', value: r['日付_返金日'].value },
          sub_item: { type: 'SINGLE_LINE_TEXT', value: '【返金】' + ((r['文字列__1行_購入商品'] || {}).value || '') },
          sub_amount: { type: 'NUMBER', value: minusAmount },
          '文字列__1行_生徒さん苗字': { type: 'SINGLE_LINE_TEXT', value: (r['文字列__1行_生徒名_苗字'] || {}).value || '' },
          '文字列__1行_生徒さん名前': { type: 'SINGLE_LINE_TEXT', value: (r['文字列__1行_生徒名_名前'] || {}).value || '' },
          '文字列__1行_生徒さんLINE名': { type: 'SINGLE_LINE_TEXT', value: (r['文字列__1行_生徒LINE名'] || {}).value || '' },
          '数量': { type: 'NUMBER', value: 1 },
          '数値_着金額': { type: 'NUMBER', value: 0 },
          '数値_決済額_振込': { type: 'NUMBER', value: 0 },
          '数値_決済額_クレカ': { type: 'NUMBER', value: 0 },
          '数値_決済額_信販': { type: 'NUMBER', value: 0 },
          '文字列__1行_今回成約の登録経路': { type: 'SINGLE_LINE_TEXT', value: '' },
          '文字列__1行_レコード番号': { type: 'SINGLE_LINE_TEXT', value: 'refund-' + r['$id'].value }
        }
      });
    });

    // 日付順ソート
    rows.sort(function (a, b) {
      var dateA = new Date(a.value.sub_date.value);
      var dateB = new Date(b.value.sub_date.value);
      return dateA - dateB;
    });

    return rows;
  }

  /**
   * レコードを1件ずつ作成＆作成IDを返す
   * ルックアップ自動コピーを発動させるため単件APIを使用
   */
  function createRecordsWithIds(appId, records) {
    if (records.length === 0) return Promise.resolve([]);

    var allIds = [];
    return records.reduce(function (promise, record) {
      return promise.then(function () {
        return kintone.api(kintone.api.url('/k/v1/record', true), 'POST', {
          app: appId,
          record: record
        }).then(function (resp) {
          allIds.push(resp.id);
        });
      });
    }, Promise.resolve()).then(function () {
      return allIds;
    });
  }

  /**
   * App 36 レコードデータ組み立て
   */
  function buildApp36Records(app44Records, sales, refunds, collectorInfo) {
    var today = getCurrentDateString();
    var period = calculatePeriod(today);
    var targetMonth = getPreviousMonth();

    var results = [];

    app44Records.forEach(function (rec44) {
      var collector = (rec44['collector_name'] || {}).value || '';
      var company = (rec44['billing_company'] || {}).value || '';
      var recNo = (rec44['レコード番号'] || {}).value || rec44['$id'].value;

      var subtableRows = buildSubtableRows(collector, company, sales, refunds);
      if (subtableRows.length === 0) return; // サブテーブル0件はスキップ

      // 請求番号: GF-YYYYMM-{App44レコード番号}
      var invoiceNo = 'GF-' + targetMonth.replace('-', '') + '-' + recNo;

      // インボイス番号
      var info = collectorInfo[collector] || {};
      var invoiceNumber = info.invoiceNumber || '';

      var app36Data = {
        'ルックアップ_集客者': { value: collector },
        billing_company: { value: company },
        '請求書発行日': { value: today },
        '請求番号': { value: invoiceNo },
        '文字列__1行_集計期間': { value: period },
        '文字列__1行_インボイス番号': { value: invoiceNumber },
        'テーブル_details_table': { value: subtableRows }
      };

      results.push({
        app44Id: rec44['$id'].value,
        app44RecNo: recNo,
        collector: collector,
        company: company,
        app36Data: app36Data,
        rowCount: subtableRows.length
      });
    });

    return results;
  }

  /**
   * App 44 のステータスを "レコード作成済" + app36_record_id 更新
   */
  function updateApp44Statuses(mappings) {
    if (mappings.length === 0) return Promise.resolve();

    var records = mappings.map(function (m) {
      return {
        id: m.app44Id,
        record: {
          status: { value: 'レコード作成済' },
          app36_record_id: { value: m.app36Id }
        }
      };
    });

    var batches = [];
    for (var i = 0; i < records.length; i += 100) {
      batches.push(records.slice(i, i + 100));
    }

    return batches.reduce(function (promise, batch) {
      return promise.then(function () {
        return kintone.api(kintone.api.url('/k/v1/records', true), 'PUT', {
          app: APP44_ID,
          records: batch
        });
      });
    }, Promise.resolve());
  }

  /**
   * Chatwork通知（App 36 作成結果）
   */
  function notifyChatworkApp36(mappings, month) {
    var lines = [
      '[info][title]集客者請求書（App 36）レコード作成完了（' + month + '請求）[/title]',
      '作成件数: ' + mappings.length + ' 件',
      ''
    ];
    mappings.sort(function (a, b) {
      return a.collector.localeCompare(b.collector);
    });
    mappings.forEach(function (m) {
      lines.push(
        '・' + m.collector +
        '（' + m.company + '）' +
        m.rowCount + '行'
      );
    });
    lines.push('[/info]');

    var body = 'body=' + encodeURIComponent(lines.join('\n'));
    var url = 'https://api.chatwork.com/v2/rooms/' + CHATWORK_ROOM_ID + '/messages';
    var headers = { 'X-ChatWorkToken': CHATWORK_TOKEN, 'Content-Type': 'application/x-www-form-urlencoded' };

    return kintone.proxy(url, 'POST', headers, body)
      .then(function (args) {
        var statusCode = args[1];
        if (statusCode === 200) {
          console.log('Chatwork通知（App36）: 送信完了');
        } else {
          console.warn('Chatwork通知（App36）: 送信失敗 (' + statusCode + ')');
        }
      })
      .catch(function (e) {
        console.warn('Chatwork通知（App36）: エラー', e);
      });
  }

  /**
   * App 36 レコード作成メインフロー
   */
  function runApp36Creation() {
    var targetMonth = getPreviousMonth();

    var msg = 'App 44 の「未作成」レコードから\n' +
              'App 36（集客者請求書）レコードを一括作成します。\n\n' +
              '請求月: ' + targetMonth + '\n\n' +
              '実行しますか？';
    if (!confirm(msg)) return;

    // 二重実行防止オーバーレイ
    var overlay = document.createElement('div');
    overlay.id = 'app36-creation-overlay';
    overlay.style.cssText =
      'position:fixed;top:0;left:0;width:100%;height:100%;' +
      'background:rgba(0,0,0,0.5);z-index:10000;display:flex;' +
      'align-items:center;justify-content:center;';
    overlay.innerHTML =
      '<div style="background:#fff;padding:40px 60px;border-radius:8px;text-align:center;">' +
      '<p style="font-size:18px;font-weight:bold;">App 36 レコード作成中...</p>' +
      '<p id="app36-status" style="color:#666;margin-top:10px;">データ取得中</p></div>';
    document.body.appendChild(overlay);

    function updateStatus(text) {
      var el = document.getElementById('app36-status');
      if (el) el.textContent = text;
    }

    updateStatus('データ取得中...');
    Promise.all([
      fetchApp44UnprocessedRecords(),
      fetchSalesForApp36(),
      fetchRefundsForApp36(),
      fetchCollectorInfo()
    ])
      .then(function (results) {
        var app44Records = results[0];
        var sales = results[1];
        var refunds = results[2];
        var collectorInfo = results[3];

        updateStatus(
          'App 44: ' + app44Records.length + '件, ' +
          'App 29: ' + sales.length + '件, ' +
          'App 39: ' + refunds.length + '件'
        );

        if (app44Records.length === 0) {
          throw new Error('App 44 に「未作成」のレコードがありません。');
        }

        // App 36 レコードデータ組み立て
        var mappings = buildApp36Records(app44Records, sales, refunds, collectorInfo);

        if (mappings.length === 0) {
          throw new Error('サブテーブルデータが0件のため、作成対象がありません。');
        }

        updateStatus('App 36: ' + mappings.length + '件 作成中...');
        var app36DataList = mappings.map(function (m) { return m.app36Data; });
        return createRecordsWithIds(APP36_ID, app36DataList).then(function (ids) {
          for (var i = 0; i < mappings.length; i++) {
            mappings[i].app36Id = ids[i];
          }
          return mappings;
        });
      })
      .then(function (mappings) {
        updateStatus('App 44 ステータス更新中...');
        return updateApp44Statuses(mappings).then(function () {
          return mappings;
        });
      })
      .then(function (mappings) {
        updateStatus('Chatwork通知中...');
        return notifyChatworkApp36(mappings, targetMonth).then(function () {
          return mappings;
        });
      })
      .then(function (mappings) {
        if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
        alert(
          'App 36 レコード作成が完了しました。\n\n' +
          '作成: ' + mappings.length + '件\n\n' +
          'Chatwork通知済み'
        );
        location.reload();
      })
      .catch(function (err) {
        if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
        alert('エラーが発生しました:\n' + (err.message || JSON.stringify(err)));
        console.error(err);
      });
  }

  // ── 一覧画面にボタン設置 ──────────────────────────────────
  kintone.events.on('app.record.index.show', function (event) {
    if (document.getElementById('btn-extract-collector')) return event;

    var space = kintone.app.getHeaderMenuSpaceElement();
    if (!space) return event;

    var btn = document.createElement('button');
    btn.id = 'btn-extract-collector';
    btn.textContent = '対象者を抽出';
    btn.style.cssText =
      'padding:8px 20px;background:#3498db;color:#fff;border:none;' +
      'border-radius:4px;cursor:pointer;font-size:14px;font-weight:bold;margin-left:10px;';
    btn.addEventListener('click', runExtraction);
    space.appendChild(btn);

    var btn36 = document.createElement('button');
    btn36.id = 'btn-create-app36';
    btn36.textContent = '集客者請求書作成';
    btn36.style.cssText =
      'padding:8px 20px;background:#e67e22;color:#fff;border:none;' +
      'border-radius:4px;cursor:pointer;font-size:14px;font-weight:bold;margin-left:10px;';
    btn36.addEventListener('click', runApp36Creation);
    space.appendChild(btn36);

    return event;
  });
})();
