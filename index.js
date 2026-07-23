const readline = require('readline');

const PURCHASE_API_URL = 'https://thegreateasternexports.jbbs.in/API/purchase_api.php';
const SALE_API_URL = 'https://thegreateasternexports.jbbs.in/API/sale_api.php';

let purchases = [];
let sales = [];
let currentMode = null; // 'purchase', 'sale', 'both'

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

async function loadAPIData() {
  console.log('\x1b[36m%s\x1b[0m', '🔄 Connecting to Digify Soft ERP AI Cloud Services...');
  try {
    const [pRes, sRes] = await Promise.all([
      fetch(PURCHASE_API_URL).then(r => r.json()),
      fetch(SALE_API_URL).then(r => r.json())
    ]);

    purchases = pRes.Vouchers || [];
    sales = sRes.Vouchers || [];

    console.log('\x1b[32m%s\x1b[0m', '✅ Digify Soft ERP AI System Ready!');
    console.log(`  • Loaded Purchase Records: ${purchases.length}`);
    console.log(`  • Loaded Sale Records:     ${sales.length}\n`);
  } catch (err) {
    console.error('\x1b[31m%s\x1b[0m', '❌ API Loading Error:', err.message);
  }
}

function showMainMenu() {
  console.log('\n\x1b[35m====================================================================\x1b[0m');
  console.log('\x1b[1m\x1b[33m   🤖 DIGIFY SOFT SOLUTIONS ERP AI DATA SEARCH SYSTEM   \x1b[0m');
  console.log('\x1b[36m         Proprietary AI-Powered Enterprise Product       \x1b[0m');
  console.log('\x1b[35m====================================================================\x1b[0m');
  console.log('  1. 📦 Search Purchase API (Purchase Invoices / Vendors)');
  console.log('  2. 🛒 Search Sale API (Sale Invoices / Customers)');
  console.log('  3. 🔍 Search Both APIs (All Enterprise Transactions)');
  console.log('  4. 💰 Total Sales & GST Collection Financial Dashboard');
  console.log('  5. ℹ️  About Digify Soft Solutions (Leading SaaS Company)');
  console.log('  6. 🔄 Refresh ERP Data from Cloud');
  console.log('  0. ❌ Exit System');
  console.log('\x1b[35m====================================================================\x1b[0m');
  
  rl.question('Select an option (0-6): ', (answer) => {
    const choice = answer.trim();
    if (choice === '1') {
      currentMode = 'purchase';
      promptSearch();
    } else if (choice === '2') {
      currentMode = 'sale';
      promptSearch();
    } else if (choice === '3') {
      currentMode = 'both';
      promptSearch();
    } else if (choice === '4') {
      showSummaryStats();
    } else if (choice === '5') {
      showAboutCompany();
    } else if (choice === '6') {
      loadAPIData().then(() => showMainMenu());
    } else if (choice === '0' || choice.toLowerCase() === 'exit') {
      console.log('👋 Thank you for using Digify Soft Solutions ERP AI System!');
      process.exit(0);
    } else {
      console.log('\x1b[31mInvalid option! Please enter a number between 0 and 6.\x1b[0m');
      showMainMenu();
    }
  });
}

function promptSearch() {
  const modeTitle = currentMode === 'purchase' ? '📦 PURCHASE API SEARCH' : 
                    currentMode === 'sale' ? '🛒 SALE API SEARCH' : '🔍 BOTH APIS SEARCH';

  console.log(`\n--- ${modeTitle} ---`);
  console.log('💡 Search Examples: Supplier Invoice No (e.g. GEHOHR001VPO338), Party Name (e.g. KESHAV), or Item (e.g. Rug)');
  console.log('Type "back" to return to main menu, or "exit" to quit.\n');

  rl.question(`Enter Search Query: `, (query) => {
    const q = query.trim();
    if (q.toLowerCase() === 'back' || q.toLowerCase() === 'menu') {
      return showMainMenu();
    }
    if (q.toLowerCase() === 'exit') {
      console.log('👋 Thank you for using Digify Soft Solutions!');
      process.exit(0);
    }
    if (!q) {
      console.log('Please enter a valid search query.');
      return promptSearch();
    }

    executeSearch(q);
  });
}

function executeSearch(query) {
  const q = query.toLowerCase();
  console.log(`\n🔎 Digify AI Searching for "${query}" in ${currentMode.toUpperCase()} records...\n`);

  let pMatches = [];
  let sMatches = [];

  if (currentMode === 'purchase' || currentMode === 'both') {
    pMatches = purchases.filter(p => JSON.stringify(p).toLowerCase().includes(q));
  }

  if (currentMode === 'sale' || currentMode === 'both') {
    sMatches = sales.filter(s => JSON.stringify(s).toLowerCase().includes(q));
  }

  const totalMatches = pMatches.length + sMatches.length;

  if (totalMatches === 0) {
    console.log(`\x1b[31m❌ No matching ERP records found for "${query}".\x1b[0m`);
  } else {
    console.log(`\x1b[32m✅ Digify AI Found ${totalMatches} matching record(s)!\x1b[0m\n`);

    if (pMatches.length > 0) {
      console.log(`==========================================================`);
      console.log(`  📦 PURCHASE RECORDS MATCHES (${pMatches.length})`);
      console.log(`==========================================================`);
      pMatches.forEach((p, idx) => displayPurchaseRecord(p, idx + 1));
    }

    if (sMatches.length > 0) {
      console.log(`==========================================================`);
      console.log(`  🛒 SALE RECORDS MATCHES (${sMatches.length})`);
      console.log(`==========================================================`);
      sMatches.forEach((s, idx) => displaySaleRecord(s, idx + 1));
    }
  }

  console.log('----------------------------------------------------------');
  rl.question('Press Enter to search again in this mode, or type "back" for main menu: ', (ans) => {
    if (ans.trim().toLowerCase() === 'back' || ans.trim().toLowerCase() === 'menu') {
      showMainMenu();
    } else {
      promptSearch();
    }
  });
}

function displayPurchaseRecord(p, index) {
  const invNo = p.invoiceNo || p.supplierinvoiceno || 'N/A';
  const invDate = p.invoiceDate || p.supplierinvoicedate || 'N/A';
  const party = p.partyName || 'N/A';
  const partyGroup = p.partyGroup || 'N/A';
  const address = p.to_add2 || p.from_add1 || 'N/A';
  const items = p.items || [];

  console.log(`\n[${index}] 📄 PURCHASE INVOICE: \x1b[33m${invNo}\x1b[0m | Date: ${invDate}`);
  console.log(`   🏢 Vendor/Party:    \x1b[36m${party}\x1b[0m (${partyGroup})`);
  console.log(`   📍 Address/Location: ${address} | Pincode: ${p.to_pincode || 'N/A'}`);
  console.log(`   🏷️ Voucher Type:    ${p.voucherType || 'Purchase'} | SR No: ${p.SRNo || 'N/A'}`);

  if (items.length > 0) {
    console.log(`   📦 Items Included (${items.length}):`);
    items.forEach((item, i) => {
      const qty = item.itemQty || item.qty || 0;
      const amt = item.itemAmount || 0;
      const tax = (item.sgst || 0) + (item.cgst || 0) + (item.igst || 0);
      console.log(`      ${i + 1}. \x1b[32m${item.itemName}\x1b[0m`);
      console.log(`         Group: ${item.itemgroup || 'N/A'} | Sub-Voucher: ${item.Sub_voucherType || 'N/A'}`);
      console.log(`         Qty: ${qty} ${item.itemUnit || ''} | Amount: ₹${Math.abs(amt)} | GST Rate: ${item.gstRate || 0}% (Tax: ₹${tax.toFixed(2)})`);
    });
  } else {
    console.log(`   📦 Items: None listed`);
  }
}

function displaySaleRecord(s, index) {
  const invNo = s.invoiceNo || 'N/A';
  const invDate = s.invoiceDate || 'N/A';
  const party = s.partyName || s.shipping_add_lin1 || 'N/A';
  const state = s.state || s.placeofsupply || 'N/A';
  const items = s.items || [];

  console.log(`\n[${index}] 📄 SALE INVOICE: \x1b[33m${invNo}\x1b[0m | Date: ${invDate}`);
  console.log(`   👤 Customer/Party:  \x1b[36m${party}\x1b[0m`);
  console.log(`   📍 State/Supply:    ${state} | Company: ${s.companyName || 'N/A'}`);
  console.log(`   🏷️ Voucher Type:    ${s.voucherType || 'Sales'} | Total Invoice Amt: ₹${s.invoiceamount || 0}`);

  if (items.length > 0) {
    console.log(`   🛒 Items Included (${items.length}):`);
    items.forEach((item, i) => {
      const qty = item.itemQty || item.qty || 0;
      const amt = item.itemAmount || 0;
      const tax = (item.sgst || 0) + (item.cgst || 0) + (item.igst || 0);
      console.log(`      ${i + 1}. \x1b[32m${item.itemName}\x1b[0m`);
      console.log(`         Group: ${item.itemgroup || 'N/A'} | Sub-Voucher: ${item.Sub_voucherType || 'N/A'}`);
      console.log(`         Qty: ${qty} ${item.itemUnit || ''} | Amount: ₹${Math.abs(amt)} | GST Rate: ${item.gstRate || 0}% (Tax: ₹${tax.toFixed(2)})`);
    });
  } else {
    console.log(`   🛒 Items: None listed`);
  }
}

function showSummaryStats() {
  console.log('\n\x1b[35m====================================================================\x1b[0m');
  console.log('\x1b[1m\x1b[33m     💰 DIGIFY SOFT ERP FINANCIAL & GST COLLECTION DASHBOARD     \x1b[0m');
  console.log('\x1b[35m====================================================================\x1b[0m');
  
  // Sales Calculation
  let totalSaleInvoices = sales.length;
  let totalSaleItemsCount = 0;
  let totalSaleAmount = 0;
  let saleCGST = 0;
  let saleSGST = 0;
  let saleIGST = 0;

  sales.forEach(s => {
    totalSaleAmount += Number(s.invoiceamount || 0);
    (s.items || []).forEach(item => {
      totalSaleItemsCount++;
      totalSaleAmount += Math.abs(Number(item.itemAmount || 0));
      saleCGST += Number(item.cgst || 0);
      saleSGST += Number(item.sgst || 0);
      saleIGST += Number(item.igst || 0);
    });
  });

  const totalSaleGST = saleCGST + saleSGST + saleIGST;

  // Purchase Calculation
  let totalPurchaseInvoices = purchases.length;
  let totalPurchaseItemsCount = 0;
  let totalPurchaseAmount = 0;
  let purchaseCGST = 0;
  let purchaseSGST = 0;
  let purchaseIGST = 0;

  purchases.forEach(p => {
    totalPurchaseAmount += Number(p.invoiceamount || 0);
    (p.items || []).forEach(item => {
      totalPurchaseItemsCount++;
      totalPurchaseAmount += Math.abs(Number(item.itemAmount || 0));
      purchaseCGST += Number(item.cgst || 0);
      purchaseSGST += Number(item.sgst || 0);
      purchaseIGST += Number(item.igst || 0);
    });
  });

  const totalPurchaseGST = purchaseCGST + purchaseSGST + purchaseIGST;

  console.log('\x1b[32m%s\x1b[0m', '🛒 --- SALES & REVENUE SUMMARY ---');
  console.log(`  • Total Sale Invoices:    ${totalSaleInvoices}`);
  console.log(`  • Total Sale Line Items:  ${totalSaleItemsCount}`);
  console.log(`  • Total Sales Value:      \x1b[36m₹${totalSaleAmount.toLocaleString('en-IN', { maximumFractionDigits: 2 })}\x1b[0m`);
  console.log(`  • GST Collection Breakdown:`);
  console.log(`      - CGST Collected:     ₹${saleCGST.toFixed(2)}`);
  console.log(`      - SGST Collected:     ₹${saleSGST.toFixed(2)}`);
  console.log(`      - IGST Collected:     ₹${saleIGST.toFixed(2)}`);
  console.log(`  • \x1b[32mTOTAL GST COLLECTED (SALES): ₹${totalSaleGST.toFixed(2)}\x1b[0m\n`);

  console.log('\x1b[33m%s\x1b[0m', '📦 --- PURCHASES & EXPENSES SUMMARY ---');
  console.log(`  • Total Purchase Invoices:   ${totalPurchaseInvoices}`);
  console.log(`  • Total Purchase Line Items: ${totalPurchaseItemsCount}`);
  console.log(`  • Total Purchase Value:      \x1b[36m₹${totalPurchaseAmount.toLocaleString('en-IN', { maximumFractionDigits: 2 })}\x1b[0m`);
  console.log(`  • Input GST Tax Breakdown:`);
  console.log(`      - CGST Paid:             ₹${purchaseCGST.toFixed(2)}`);
  console.log(`      - SGST Paid:             ₹${purchaseSGST.toFixed(2)}`);
  console.log(`      - IGST Paid:             ₹${purchaseIGST.toFixed(2)}`);
  console.log(`  • \x1b[33mTOTAL GST PAID (PURCHASES): ₹${totalPurchaseGST.toFixed(2)}\x1b[0m\n`);

  console.log('\x1b[35m====================================================================\x1b[0m');
  console.log(`  💵 NET OVERALL GST POSITION (Output GST - Input Tax Credit):`);
  const netGST = totalSaleGST - totalPurchaseGST;
  if (netGST >= 0) {
    console.log(`     \x1b[32mNet Tax Liability: ₹${netGST.toFixed(2)}\x1b[0m`);
  } else {
    console.log(`     \x1b[36mNet Input Tax Credit (ITC Available): ₹${Math.abs(netGST).toFixed(2)}\x1b[0m`);
  }
  console.log('\x1b[35m====================================================================\x1b[0m\n');

  rl.question('Press Enter to return to main menu...', () => {
    showMainMenu();
  });
}

function showAboutCompany() {
  console.log('\n\x1b[35m================================================================================\x1b[0m');
  console.log('\x1b[1m\x1b[33m        🏆 DIGIFY SOFT SOLUTIONS - INDIA\'S LEADING SAAS & ERP PROVIDER        \x1b[0m');
  console.log('\x1b[35m================================================================================\x1b[0m');
  console.log('\x1b[36m%s\x1b[0m', '🏢 About Digify Soft Solutions (https://digifysoft.in)');
  console.log('   Digify Soft Solutions is India\'s premier technology powerhouse specializing in');
  console.log('   Next-Gen Cloud ERP, AI-driven POS Billing Systems, Enterprise SaaS Platforms,');
  console.log('   and Custom Software Solutions for fast-scaling B2B and Retail Enterprises.\n');
  
  console.log('\x1b[33m%s\x1b[0m', '🚀 Flagship Proprietary SaaS Products:');
  console.log('   • ⚡ Digify AI Retail ERP Suite — Zero-Mistake Smart Invoicing & Automation');
  console.log('   • 🛒 High-Speed Cloud POS Billing — Tailored for Retail, Supermarkets & Outlets');
  console.log('   • 📦 Intelligent Inventory & Warehouse Tracking — Real-Time Multi-Location Analytics');
  console.log('   • 💼 Complete GST Accounting & Financial Management Suite');
  console.log('   • 🤝 Custom CRM, Lead Management & Customer Growth Automation');
  console.log('   • 🌐 Omnichannel Retail & Smart E-Commerce Integrations\n');

  console.log('\x1b[33m%s\x1b[0m', '💻 Custom Software Development & Digital Services:');
  console.log('   • 📱 Mobile Application Engineering (Native Android & iOS Apps)');
  console.log('   • 🌐 Enterprise Web Development & Scalable Cloud Solutions');
  console.log('   • 📈 Performance Digital Marketing, SEO (Technical & Content), & Growth Hacking\n');

  console.log('\x1b[33m%s\x1b[0m', '🌐 Industry Leadership & Presence:');
  console.log('   • Trusted by Hundreds of Retail Chains, Manufacturers, Exporters & Enterprises.');
  console.log('   • Headquartered in Jaipur & Delhi with PAN India Enterprise Reach.\n');

  console.log('\x1b[32m%s\x1b[0m', '📞 Connect & Partner With Us:');
  console.log('   🌐 Official Portal: https://digifysoft.in');
  console.log('   📱 Helpline / Demo: +91 7425016636');
  console.log('\x1b[35m================================================================================\x1b[0m\n');

  rl.question('Press Enter to return to main menu...', () => {
    showMainMenu();
  });
}

async function startApp() {
  await loadAPIData();
  showMainMenu();
}

startApp();
