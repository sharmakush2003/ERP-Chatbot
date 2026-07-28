const readline = require('readline');

const PURCHASE_API_URL = 'https://thegreateasternexports.jbbs.in/API/purchase_api.php';
const SALE_API_URL = 'https://thegreateasternexports.jbbs.in/API/sale_api.php';

let state = {
  purchases: [],
  sales: [],
  isLoading: true
};

async function fetchData() {
  console.log('\x1b[36m%s\x1b[0m', '🔄 Fetching data from ERP APIs...');
  try {
    const [purchaseRes, saleRes] = await Promise.all([
      fetch(PURCHASE_API_URL).then(r => r.json()),
      fetch(SALE_API_URL).then(r => r.json())
    ]);

    state.purchases = purchaseRes.Vouchers || [];
    state.sales = saleRes.Vouchers || [];
    state.isLoading = false;

    console.log('\x1b[32m%s\x1b[0m', '✅ Data loaded successfully!');
    console.log(`📦 Loaded ${state.purchases.length} Purchase records.`);
    console.log(`🛒 Loaded ${state.sales.length} Sale records.\n`);
  } catch (error) {
    console.error('\x1b[31m%s\x1b[0m', '❌ Error fetching API data:', error.message);
    state.isLoading = false;
  }
}

function processQuery(query) {
  const q = query.trim().toLowerCase();

  if (!q) return promptUser();

  if (q === 'exit' || q === 'quit') {
    console.log('👋 Exiting ERP Chatbot CLI. Good day!');
    process.exit(0);
  }

  if (q === 'reload' || q === 'refresh') {
    return fetchData().then(() => promptUser());
  }

  if (q === 'help') {
    console.log('\n📌 Available Commands / Query Examples:');
    console.log('  1. stats                      - Business Executive Summary & Counts');
    console.log('  2. sales-month / sales-date   - Month-wise, Date-wise & Year Sales Analytics');
    console.log('  3. purchases-month            - Month-wise, Date-wise & Year Purchases Analytics');
    console.log('  4. dispatch                   - Month & Day Dispatch Summary');
    console.log('  5. inventory                  - Total Inventory Stock & Valuation');
    console.log('  6. product <name>             - Product-wise Stock & Inventory Lookup');
    console.log('  7. party <name>               - Filter by supplier/customer name');
    console.log('  8. search <keyword>           - Search keyword across all records');
    console.log('  9. reload                     - Fetch fresh data from ERP API');
    console.log(' 10. exit                       - Quit CLI\n');
    return promptUser();
  }

  if (q.includes('sale') && (q.includes('month') || q.includes('date') || q.includes('year') || q.includes('daily') || q.includes('monthly'))) {
    const byMonth = {};
    state.sales.forEach(s => {
      const d = s.invoiceDate || s.supplierinvoicedate || '';
      if (!d) return;
      const month = d.substring(0, 7);
      if (!byMonth[month]) byMonth[month] = { revenue: 0, count: 0 };
      byMonth[month].revenue += Number(s.invoiceamount || 0);
      byMonth[month].count += 1;
    });

    console.log('\n🛒 === MONTH-WISE SALES REPORT ===');
    Object.entries(byMonth).forEach(([m, val]) => {
      console.log(`  • ${m}: ₹${val.revenue.toLocaleString('en-IN')} (${val.count} Invoices)`);
    });
    console.log('\n');
    return promptUser();
  }

  if (q.includes('purchase') && (q.includes('month') || q.includes('date') || q.includes('year') || q.includes('daily') || q.includes('monthly'))) {
    const byMonth = {};
    state.purchases.forEach(p => {
      const d = p.invoiceDate || p.supplierinvoicedate || '';
      if (!d) return;
      const month = d.substring(0, 7);
      if (!byMonth[month]) byMonth[month] = { expense: 0, count: 0 };
      let amt = Number(p.invoiceamount || 0);
      (p.items || []).forEach(i => amt += Math.abs(Number(i.itemAmount || 0)));
      byMonth[month].expense += amt;
      byMonth[month].count += 1;
    });

    console.log('\n📦 === MONTH-WISE PURCHASES REPORT ===');
    Object.entries(byMonth).forEach(([m, val]) => {
      console.log(`  • ${m}: ₹${val.expense.toLocaleString('en-IN')} (${val.count} Invoices)`);
    });
    console.log('\n');
    return promptUser();
  }

  if (q.includes('dispatch')) {
    let totalQty = 0;
    let totalVal = 0;
    state.sales.forEach(s => {
      totalVal += Number(s.invoiceamount || 0);
      (s.items || []).forEach(i => totalQty += Number(i.itemQty || i.qty || 1));
    });

    console.log('\n🚚 === DISPATCH SUMMARY REPORT ===');
    console.log(`Total Outward Dispatched Units: ${totalQty.toLocaleString('en-IN')} units`);
    console.log(`Total Dispatch Revenue Value:   ₹${totalVal.toLocaleString('en-IN')}\n`);
    return promptUser();
  }

  if (q.includes('inventory') || q.startsWith('product ')) {
    const searchProd = q.replace(/^product\s+/, '').replace(/^inventory\s+/, '').replace(/stock/g, '').trim();
    const itemMap = {};

    state.purchases.forEach(p => {
      (p.items || []).forEach(i => {
        const name = i.itemName?.trim() || 'Unknown';
        if (!itemMap[name]) itemMap[name] = { name, pur: 0, sale: 0 };
        itemMap[name].pur += Number(i.itemQty || i.qty || 1);
      });
    });

    state.sales.forEach(s => {
      (s.items || []).forEach(i => {
        const name = i.itemName?.trim() || 'Unknown';
        if (!itemMap[name]) itemMap[name] = { name, pur: 0, sale: 0 };
        itemMap[name].sale += Number(i.itemQty || i.qty || 1);
      });
    });

    let items = Object.values(itemMap);
    if (searchProd && searchProd !== 'inventory' && searchProd !== 'summary') {
      items = items.filter(it => it.name.toLowerCase().includes(searchProd.toLowerCase()));
      console.log(`\n📦 === PRODUCT INVENTORY LOOKUP FOR "${searchProd}" ===`);
    } else {
      console.log('\n🏭 === OVERALL INVENTORY STOCK SUMMARY ===');
      console.log(`Total Tracked Products: ${items.length}`);
    }

    items.slice(0, 10).forEach((it, idx) => {
      const netStock = Math.max(0, it.pur - it.sale);
      console.log(`  ${idx + 1}. ${it.name}`);
      console.log(`     Dispatched (Sold): ${it.sale} | Purchased: ${it.pur} | Net Stock: ${netStock}`);
    });
    console.log('\n');
    return promptUser();
  }

  if (q === 'stats' || q.includes('total') || q.includes('count') || q.includes('summary')) {
    console.log('\n📊 === ERP SUMMARY STATS ===');
    console.log(`Total Purchase Transactions: ${state.purchases.length}`);
    console.log(`Total Sale Transactions:     ${state.sales.length}`);
    
    let totalPurchaseItems = 0;
    state.purchases.forEach(p => { totalPurchaseItems += (p.items || []).length; });

    let totalSaleItems = 0;
    state.sales.forEach(s => { totalSaleItems += (s.items || []).length; });

    console.log(`Total Purchase Items:        ${totalPurchaseItems}`);
    console.log(`Total Sale Items:            ${totalSaleItems}\n`);
    return promptUser();
  }

  if (q === 'purchases' || q.includes('latest purchase')) {
    console.log(`\n📦 === LATEST PURCHASES (Showing 5 of ${state.purchases.length}) ===`);
    const sample = state.purchases.slice(0, 5);
    sample.forEach((p, idx) => {
      console.log(`\n[${idx + 1}] Invoice No: ${p.invoiceNo || p.supplierinvoiceno} | Date: ${p.invoiceDate}`);
      console.log(`    Party: ${p.partyName || 'N/A'} (${p.partyGroup || 'N/A'})`);
      console.log(`    Items: ${(p.items || []).map(i => `${i.itemName} (Qty: ${i.itemQty || i.qty || 0})`).join(', ') || 'None'}`);
    });
    console.log('\n');
    return promptUser();
  }

  if (q === 'sales' || q.includes('latest sale')) {
    console.log(`\n🛒 === LATEST SALES (Showing 5 of ${state.sales.length}) ===`);
    const sample = state.sales.slice(0, 5);
    sample.forEach((s, idx) => {
      console.log(`\n[${idx + 1}] Invoice No: ${s.invoiceNo} | Date: ${s.invoiceDate}`);
      console.log(`    Party: ${s.partyName || s.shipping_add_lin1 || 'N/A'} | State: ${s.state || s.placeofsupply || 'N/A'}`);
      console.log(`    Items: ${(s.items || []).map(i => `${i.itemName} (Qty: ${i.itemQty || i.qty || 0})`).join(', ') || 'None'}`);
    });
    console.log('\n');
    return promptUser();
  }

  // General Search / Party / Item Search
  const searchTerm = q.replace(/^search\s+/, '').replace(/^party\s+/, '').replace(/^item\s+/, '');
  console.log(`\n🔍 Searching records for: "${searchTerm}" ...`);

  const matchedPurchases = state.purchases.filter(p => {
    const jsonStr = JSON.stringify(p).toLowerCase();
    return jsonStr.includes(searchTerm);
  });

  const matchedSales = state.sales.filter(s => {
    const jsonStr = JSON.stringify(s).toLowerCase();
    return jsonStr.includes(searchTerm);
  });

  console.log(`Found ${matchedPurchases.length} Purchase match(es) and ${matchedSales.length} Sale match(es).\n`);

  if (matchedPurchases.length > 0) {
    console.log(`📦 --- Purchase Matches (Top 3) ---`);
    matchedPurchases.slice(0, 3).forEach(p => {
      console.log(`• Invoice: ${p.invoiceNo || p.supplierinvoiceno} | Party: ${p.partyName || 'N/A'} | Date: ${p.invoiceDate}`);
      if (p.items) {
        p.items.forEach(item => console.log(`  - Item: ${item.itemName} | Group: ${item.itemgroup}`));
      }
    });
  }

  if (matchedSales.length > 0) {
    console.log(`\n🛒 --- Sale Matches (Top 3) ---`);
    matchedSales.slice(0, 3).forEach(s => {
      console.log(`• Invoice: ${s.invoiceNo} | Party/Address: ${s.partyName || s.shipping_add_lin1 || 'N/A'} | Date: ${s.invoiceDate}`);
      if (s.items) {
        s.items.forEach(item => console.log(`  - Item: ${item.itemName} | Group: ${item.itemgroup}`));
      }
    });
  }

  if (matchedPurchases.length === 0 && matchedSales.length === 0) {
    console.log('❌ No matching purchase or sale records found.');
  }

  console.log('\n');
  promptUser();
}

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function promptUser() {
  rl.question('🤖 ERP Chatbot > ', (answer) => {
    processQuery(answer);
  });
}

// Start app
async function main() {
  console.log('====================================================');
  console.log('       🤖 ERP CHATBOT TESTER (CLI MODE)');
  console.log('====================================================');
  console.log('Testing APIs:');
  console.log('  Purchase API: ' + PURCHASE_API_URL);
  console.log('  Sale API:     ' + SALE_API_URL);
  console.log('----------------------------------------------------\n');

  await fetchData();
  console.log('Type "help" to see available commands or type any search query/keyword!\n');
  promptUser();
}

main();
