const MONTH_MAP = {
  'january': '01', 'jan': '01',
  'february': '02', 'feb': '02',
  'march': '03', 'mar': '03',
  'april': '04', 'apr': '04',
  'may': '05',
  'june': '06', 'jun': '06',
  'july': '07', 'jul': '07',
  'august': '08', 'aug': '08',
  'september': '09', 'sep': '09',
  'october': '10', 'oct': '10',
  'november': '11', 'nov': '11',
  'december': '12', 'dec': '12'
};

function parseMonthFilter(filterStr) {
  const str = filterStr.toLowerCase().trim();
  let year = '2026';
  const yearMatch = str.match(/\b(20\d\d)\b/);
  if (yearMatch) year = yearMatch[1];

  let monthNum = null;
  for (const [mName, mCode] of Object.entries(MONTH_MAP)) {
    if (str.includes(mName)) {
      monthNum = mCode;
      break;
    }
  }

  const codeMatch = str.match(/\b(0[1-9]|1[0-2])\b/);
  if (!monthNum && codeMatch) monthNum = codeMatch[1];

  let isoPrefix = null;
  if (year && monthNum) isoPrefix = `${year}-${monthNum}`;
  else if (year) isoPrefix = `${year}`;

  return { year, monthNum, isoPrefix };
}

console.log('April 2026:', parseMonthFilter('April 2026'));
console.log('May 2026:', parseMonthFilter('May 2026'));
console.log('2026-04:', parseMonthFilter('2026-04'));
console.log('2026-04-15:', parseMonthFilter('2026-04-15'));
