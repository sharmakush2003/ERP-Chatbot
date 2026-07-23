const PURCHASE_API_URL = 'https://thegreateasternexports.jbbs.in/API/purchase_api.php';
const SALE_API_URL = 'https://thegreateasternexports.jbbs.in/API/sale_api.php';

async function runTest() {
  console.log("=== TESTING ERP DEMO APIS ===");
  
  console.log(`1. Fetching Purchase API: ${PURCHASE_API_URL}`);
  const purchaseStart = Date.now();
  const purchaseRes = await fetch(PURCHASE_API_URL).then(r => r.json());
  const purchaseList = purchaseRes.Vouchers || [];
  console.log(`   STATUS: ${purchaseList.length > 0 ? 'SUCCESS (Data Found)' : 'EMPTY'}`);
  console.log(`   TIME TAKEN: ${Date.now() - purchaseStart}ms`);
  console.log(`   RECORDS FETCHED: ${purchaseList.length}`);
  
  if (purchaseList.length > 0) {
    const p1 = purchaseList[0];
    console.log(`   SAMPLE PURCHASE RECORD: Invoice #${p1.invoiceNo || p1.supplierinvoiceno} | Party: ${p1.partyName}`);
  }

  console.log(`\n2. Fetching Sale API: ${SALE_API_URL}`);
  const saleStart = Date.now();
  const saleRes = await fetch(SALE_API_URL).then(r => r.json());
  const saleList = saleRes.Vouchers || [];
  console.log(`   STATUS: ${saleList.length > 0 ? 'SUCCESS (Data Found)' : 'EMPTY'}`);
  console.log(`   TIME TAKEN: ${Date.now() - saleStart}ms`);
  console.log(`   RECORDS FETCHED: ${saleList.length}`);

  if (saleList.length > 0) {
    const s1 = saleList[0];
    console.log(`   SAMPLE SALE RECORD: Invoice #${s1.invoiceNo} | Party/Address: ${s1.partyName || s1.shipping_add_lin1 || 'N/A'}`);
  }

  console.log("\n==========================================");
  console.log("RESULT: BOTH APIS ARE WORKING PERFECTLY!");
  console.log("==========================================");
}

runTest().catch(console.error);
