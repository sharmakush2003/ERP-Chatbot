const PURCHASE_API_URL = 'https://thegreateasternexports.jbbs.in/API/purchase_api.php';
const SALE_API_URL = 'https://thegreateasternexports.jbbs.in/API/sale_api.php';

async function testAPIs() {
  try {
    const pRes = await fetch(PURCHASE_API_URL).then(r => r.json());
    const sRes = await fetch(SALE_API_URL).then(r => r.json());

    console.log('Purchase API Type:', Array.isArray(pRes) ? 'Array' : typeof pRes, 'Length/Keys:', Array.isArray(pRes) ? pRes.length : Object.keys(pRes));
    console.log('Sale API Type:', Array.isArray(sRes) ? 'Array' : typeof sRes, 'Length/Keys:', Array.isArray(sRes) ? sRes.length : Object.keys(sRes));

    if (Array.isArray(sRes) && sRes.length > 0) {
      console.log('Sample Sale Record Keys:', Object.keys(sRes[0]));
      console.log('Sample Sale Date:', sRes[0].invoiceDate || sRes[0].supplierinvoicedate || sRes[0].date);
    }
    if (Array.isArray(pRes) && pRes.length > 0) {
      console.log('Sample Purchase Record Keys:', Object.keys(pRes[0]));
      console.log('Sample Purchase Date:', pRes[0].invoiceDate || pRes[0].supplierinvoicedate || pRes[0].date);
    }
  } catch (err) {
    console.error('Fetch test error:', err.message);
  }
}

testAPIs();
