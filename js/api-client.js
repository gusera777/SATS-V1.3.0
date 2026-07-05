import { clamp } from './utils.js';
import { state } from './state.js';
import { API_KEY_POOL } from './api-key-pool.js';

/* ═══════════════════════════════════════════════════════════
   DATA FETCH
   ═══════════════════════════════════════════════════════════ */
/* A candle row is only usable if OHLC are finite numbers, all positive,
   and high/low actually bound open & close. Volume is optional (defaults
   to 0 for pairs with no volume data) but must be a finite, non-negative
   number when present. Bad rows are dropped rather than silently turned
   into NaN, which would otherwise poison every downstream indicator
   (EMA/ATR/RSI/etc. all propagate NaN forward once it appears). */
export function isValidCandleRow(c){
  if(!c || !c.time) return false;
  const ohlc = [c.open, c.high, c.low, c.close];
  if(ohlc.some(v => typeof v!=='number' || !isFinite(v) || v<=0)) return false;
  if(!isFinite(c.volume) || c.volume<0) return false; // already normalized to 0 by caller when unparsable
  if(c.high < c.low) return false;
  if(c.high < c.open || c.high < c.close) return false;
  if(c.low > c.open || c.low > c.close) return false;
  return true;
}

export async function fetchCandlesRaw(symbol, interval, outputSize, apiKey){
  const url = `https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(symbol)}&interval=${interval}&outputsize=${outputSize}&apikey=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url);
  const json = await res.json();
  if(json.status==='error' || json.code){
    const msg = json.message || 'API error';
    const err = new Error(msg);
    // Ditandai sebagai rate-limit hanya kalau memang soal limit/quota/HTTP 429 — error lain
    // (symbol salah, interval tidak didukung, dll) TIDAK ditandai, supaya fetchWithKeyRotation
    // di bawah tidak buang-buang percobaan pindah key untuk error yang tidak akan pernah
    // hilang dengan key manapun.
    err.isRateLimit = res.status===429 || json.code===429 || /credit|limit|too many request/i.test(msg);
    throw err;
  }
  if(!json.values) throw new Error('Format data tidak dikenal dari API.');
  const rawCount = json.values.length;
  const candles = json.values.map(v=>{
    const vol = parseFloat(v.volume||0);
    return { time: v.datetime, open:parseFloat(v.open), high:parseFloat(v.high), low:parseFloat(v.low),
      close:parseFloat(v.close), volume: isFinite(vol) ? vol : 0 };
  }).filter(isValidCandleRow).reverse();
  const dropped = rawCount - candles.length;
  if(dropped>0) console.warn(`fetchCandlesRaw(${symbol} ${interval}): ${dropped} baris tidak valid dari API dilewati (dari ${rawCount} total).`);
  if(candles.length===0) throw new Error('Semua data dari API tidak valid (OHLC kosong/rusak).');
  return candles;
}

/* ═══════════════════════════════════════════════════════════
   AUTO-SWITCH API KEY (pool bawaan + key pribadi opsional)
   ─────────────────────────────────────────────────────────
   Key pribadi (kalau diisi di ⚙ Pengaturan) selalu jadi kandidat PERTAMA, diikuti
   5 key bawaan (API_KEY_POOL). apiKeyIndex menunjuk key yang TERAKHIR TERBUKTI
   jalan, disimpan lintas sesi (localStorage) supaya reload berikutnya tidak
   mengulang dari key yang sudah diketahui kena limit. */
export function getApiKeyPool(){
  const custom = (state.apiKey||'').trim();
  const pool = API_KEY_POOL.slice();
  if(custom && !pool.includes(custom)) pool.unshift(custom);
  return pool;
}
const LS_KEY_INDEX = 'gusera_sats_api_key_index';
export function loadApiKeyIndex(){
  let v = 0;
  try{ v = parseInt(localStorage.getItem(LS_KEY_INDEX),10); }catch(e){}
  state.apiKeyIndex = (isFinite(v) && v>=0) ? v : 0;
}
export function saveApiKeyIndex(){
  try{ localStorage.setItem(LS_KEY_INDEX, String(state.apiKeyIndex)); }catch(e){}
}

/* Mencoba tiap key di pool secara berurutan, mulai dari apiKeyIndex terakhir yang
   terbukti jalan. HANYA pindah ke key berikutnya kalau errornya isRateLimit===true
   (limit/quota) — error lain langsung dilempar apa adanya (mengganti key tidak akan
   memperbaiki symbol salah atau format tidak dikenal, jadi tidak perlu 5x percobaan
   yang sama-sama pasti gagal). Kalau SEMUA key di pool kena limit, error terakhir
   dilempar dengan pesan gabungan yang jelas. */
export async function fetchWithKeyRotation(fetchFn){
  const pool = getApiKeyPool();
  let idx = clamp(state.apiKeyIndex, 0, pool.length-1);
  let lastErr = null;
  for(let attempt=0; attempt<pool.length; attempt++){
    try{
      const result = await fetchFn(pool[idx]);
      if(state.apiKeyIndex !== idx){ state.apiKeyIndex = idx; saveApiKeyIndex(); }
      state.apiKeyPoolSize = pool.length; // dipakai UI untuk menampilkan "N/M"
      return result;
    }catch(e){
      lastErr = e;
      if(!e.isRateLimit) throw e;
      idx = (idx+1) % pool.length;
    }
  }
  state.apiKeyIndex = idx; saveApiKeyIndex();
  state.apiKeyPoolSize = pool.length;
  const err = new Error(`Semua ${pool.length} API key kena limit/quota. Coba lagi nanti, isi key pribadi Anda sendiri, atau pakai Mode CSV. (Pesan terakhir: ${lastErr?lastErr.message:'-'})`);
  err.allKeysExhausted = true;
  throw err;
}

export async function fetchCandles(){
  return fetchWithKeyRotation(key => fetchCandlesRaw(state.symbol, state.interval, state.outputSize, key));
}
export function parseCsv(text){
  const lines = text.trim().split('\n').map(l=>l.trim()).filter(Boolean);
  const candles = [];
  const badLines = [];
  lines.forEach((line, idx)=>{
    const parts = line.split(',').map(s=>s.trim());
    if(parts.length<5){ badLines.push(idx+1); return; }
    const [time,open,high,low,close,volume] = parts;
    const volParsed = parseFloat(volume||0);
    const c = {time, open:parseFloat(open), high:parseFloat(high), low:parseFloat(low), close:parseFloat(close), volume: isFinite(volParsed) ? volParsed : 0};
    if(isValidCandleRow(c)) candles.push(c); else badLines.push(idx+1);
  });
  if(candles.length===0){
    throw new Error('Tidak ada baris valid. Cek format: time,open,high,low,close,volume — dan pastikan OHLC berupa angka positif dengan high ≥ open/close ≥ low.');
  }
  if(badLines.length>0){
    const shown = badLines.slice(0,10).join(', ') + (badLines.length>10 ? `, +${badLines.length-10} lagi` : '');
    console.warn(`parseCsv: ${badLines.length} baris dilewati (baris ke-${shown}).`);
  }
  return { candles, skipped: badLines.length, skippedLines: badLines };
}
