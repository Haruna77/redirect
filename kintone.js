(function() {
    "use strict";
    kintone.events.on(['app.record.create.submit', 'app.record.edit.submit'], function(event) {
      var record = event.record;
      var purchaseItem = record['ルックアップ_購入商品']['value'];
  
      if (purchaseItem && purchaseItem.includes('卸')) {
        record['wholesale_flag']['value'] = '卸';
      } else {
        record['wholesale_flag']['value'] = '';
      }
      return event;
    });
  })();