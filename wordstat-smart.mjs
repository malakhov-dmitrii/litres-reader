import { readFileSync, writeFileSync, existsSync } from 'fs';

const TOKEN = 'y0__xCXnsliGPahPiDWt9zHFjCFpv6wCDyF5zShfzQ8A2duPI610JojyuZu';
const RESULTS_FILE = './wordstat-books.json';
const DELAY_MS = 220;

const books = JSON.parse(readFileSync('./books.json', 'utf8'));
const ratings = JSON.parse(readFileSync('./litres-ratings.json', 'utf8'));

// Only rated books
const ratedBooks = books.filter(b => ratings[b.id]?.rating);
console.log(`Books with rating: ${ratedBooks.length}`);

// Query = title as-is. Generic short titles are filtered by MIN_REVIEWS gate,
// so "Встреча" with 1 review still gets P=0 even with 4M wordstat.
function buildQuery(book) {
  return book.title.trim();
}

let results = {};
if (existsSync(RESULTS_FILE)) {
  results = JSON.parse(readFileSync(RESULTS_FILE, 'utf8'));
  console.log(`Loaded ${Object.keys(results).length} existing`);
}

// Deduplicate by query (same query = same result)
const seenQuery = new Map(); // query → bookId already done
for (const [id, val] of Object.entries(results)) {
  if (val.query) seenQuery.set(val.query, id);
}

const pending = ratedBooks.filter(b => !(b.id in results));
console.log(`Pending: ${pending.length}\n`);

async function fetchWordstat(phrase) {
  const resp = await fetch('https://api.wordstat.yandex.net/v1/topRequests', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + TOKEN, 'Content-Type': 'application/json' },
    body: JSON.stringify({ phrase, numPhrases: 1 }),
  });
  if (resp.status === 429) throw new Error('rate_limit');
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const data = await resp.json();
  return data.totalCount ?? 0;
}

let done = 0;
let errors = 0;
let reused = 0;

for (const book of pending) {
  const query = buildQuery(book);

  // Reuse if same query already fetched
  if (seenQuery.has(query)) {
    const srcId = seenQuery.get(query);
    results[book.id] = { ...results[srcId], reused: true };
    done++;
    reused++;
    continue;
  }

  try {
    const volume = await fetchWordstat(query);
    results[book.id] = { volume, query };
    seenQuery.set(query, book.id);
    done++;

    const words = book.title.trim().split(/\s+/).length;
    const tag = words <= 2 ? '📌' : '  ';
    process.stdout.write(`[${done}/${pending.length}] ${tag} ${volume > 0 ? volume.toLocaleString() : '—'} | "${query.slice(0, 55)}"\n`);
  } catch (err) {
    if (err.message === 'rate_limit') {
      console.log('Rate limit, sleep 60s...');
      await new Promise(r => setTimeout(r, 60_000));
      try {
        const volume = await fetchWordstat(query);
        results[book.id] = { volume, query };
        seenQuery.set(query, book.id);
        done++;
      } catch (e) {
        errors++;
      }
    } else {
      console.log(`ERR: ${err.message} | "${query.slice(0, 50)}"`);
      results[book.id] = { volume: 0, query, error: err.message };
      done++;
      errors++;
    }
  }

  if (done % 50 === 0) {
    writeFileSync(RESULTS_FILE, JSON.stringify(results, null, 2));
    console.log(`  → saved (${done}/${pending.length}), reused: ${reused}, errors: ${errors}`);
  }

  await new Promise(r => setTimeout(r, DELAY_MS));
}

writeFileSync(RESULTS_FILE, JSON.stringify(results, null, 2));
console.log(`\nДone! ${done} processed (${reused} reused), ${errors} errors`);
