#!/usr/bin/env node
// Designed by TiantianYe
// 学科网批量下载 v2：账号有网校通权益，付费资源确认框显示"免费"
// 流程：详情页 -> 点下载按钮 -> 确认框校验(必须含"免费") -> 确认 -> (重新下载兜底) -> 归档/解压
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const PROXY = "http://localhost:3456";
const TARGET = process.argv[2];
const LIST_FILE = process.argv[3];
const BASE = "/Users/tiantianye/Documents/初中数学上半学期期中考试试卷整理/沪教版五四制上海期中卷";
const DL_DIR = path.join(process.env.HOME, "Downloads");
const LOG = path.join(BASE, "download_log.json");

function post(ep, body) {
  const res = execSync(
    `curl -s -X POST --data-raw ${JSON.stringify(body)} "${PROXY}${ep}?target=${TARGET}" --max-time 30`
  ).toString();
  try { return JSON.parse(res); } catch { return { value: res }; }
}
// 关键修复：JSON.stringify 会把换行转成字面量 "\n" 传给 shell，导致代理收到非法 JS。
// 发送前把所有换行+缩进折叠为单个空格（我们的 eval 语句都有分号/花括号结尾，无 ASI 风险）。
const evalJS = (js) => post("/eval", js.replace(/\s*\n\s*/g, " ")).value;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function snapshot() { try { return fs.readdirSync(DL_DIR).filter((f) => fs.statSync(path.join(DL_DIR, f)).isFile()); } catch { return []; } }
function loadLog() { try { return JSON.parse(fs.readFileSync(LOG, "utf8")); } catch { return { done: {}, failed: {} }; } }
function saveLog(l) {
  try { fs.writeFileSync(LOG, JSON.stringify(l, null, 2)); }
  catch (e) { console.log("WARN: saveLog failed (sandbox deny?), continue:", String(e).slice(0, 80)); }
}

async function waitFor(fn, timeout, interval = 1500) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    try { const r = fn(); if (r) return r; } catch {}
    await sleep(interval);
  }
  return null;
}

function extractZip(zipPath, destDir) {
  // 用独立脚本文件执行，避免内联 python -c 的换行转义问题
  const out = execSync(`python3 "${path.join(__dirname, "extract_all_zips.py")}" --one "${zipPath}" "${destDir}"`).toString().trim();
  return out ? out.split(";") : [];
}

async function downloadOne(item, grade) {
  const id = item.id;
  // 0. 页面可见性保护：学科网下载 JS 检测 document.hidden，后台标签页点击会被静默忽略
  const vis = await waitFor(() => {
    const r = evalJS('(() => { return "VIS=" + document.visibilityState; })()');
    return String(r) === "VIS=visible" ? true : null;
  }, 15 * 60 * 1000, 5000);
  if (!vis) return { ok: false, reason: "tab_not_visible_timeout" };
  // 1. 打开详情页
  evalJS(`location.href = "https://www.zxxk.com/soft/${id}.html"; "nav"`);
  await sleep(6000);
  // 2. 等待页面就绪并找可见下载按钮（offsetParent 判定，后台标签页布局延迟不影响）
  const marked = await waitFor(() => {
    const r = evalJS(`(() => {
      const els = [...document.querySelectorAll("#btnSoftDownload")].filter(el => el.offsetParent !== null);
      if (!els.length) return "COUNT=0 ready=" + document.readyState;
      els[0].id = "dlBtnVisible";
      return "TEXT=[" + els[0].textContent.trim() + "]";
    })()`);
    const s = String(r || "");
    if (s.startsWith("TEXT=[")) return s.slice(6, -1);
    return null;
  }, 40000);
  if (!marked) return { ok: false, reason: "no_button" };
  // 3. 真实鼠标点击
  post("/clickAt", "#dlBtnVisible");
  await sleep(3000);
  // 4. 确认框：必须显示"免费"才确认（网校通权益）；若要求真实支付则中止
  let confirmed = false;
  const dlg = await waitFor(() => {
    const r = evalJS(`(() => {
      const f = [...document.querySelectorAll("iframe")].find(f => f.src === "about:blank" && f.offsetParent !== null);
      if (!f) return "NO_IFRAME";
      const doc = f.contentDocument; if (!doc || !doc.body) return "NO_DOC";
      const btn = doc.querySelector(".balance-payment-btn");
      if (!btn) return "NO_BTN_YET";
      return "DLG=[" + doc.body.innerText.replace(/\\n+/g, " | ").slice(0, 200) + "]";
    })()`);
    const s = String(r || "");
    if (s.startsWith("DLG=[")) return s.slice(5, -1);
    return null;
  }, 15000);
  if (dlg) {
    if (/免费|0\.00/.test(dlg)) {
      evalJS(`(() => {
        const f = [...document.querySelectorAll("iframe")].find(f => f.src === "about:blank" && f.offsetParent !== null);
        if (!f) return "no";
        const btn = f.contentDocument && f.contentDocument.querySelector(".balance-payment-btn");
        if (!btn) return "no";
        btn.click(); return "yes";
      })()`);
      confirmed = true;
    } else {
      return { ok: false, reason: "needs_real_payment", dialog: dlg };
    }
  }
  // 5. 等待文件出现（或状态页 -> 重新下载）
  const before = snapshot();
  let file = await waitFor(() => {
    const now = snapshot();
    const nf = now.find((f) => !before.includes(f) && !f.endsWith(".crdownload"));
    return nf || null;
  }, 20000);
  if (!file) {
    const hasRl = await waitFor(() => {
      const r = evalJS(`(() => {
        const a = [...document.querySelectorAll("a")].find(a => (a.textContent||"").includes("重新下载") && a.offsetParent !== null);
        if (!a) return "NO_LINK"; a.id = "redlLink"; return "YES";
      })()`);
      return String(r) === "YES";
    }, 15000);
    if (hasRl) {
      post("/clickAt", "#redlLink");
      file = await waitFor(() => {
        const now = snapshot();
        const nf = now.find((f) => !before.includes(f) && !f.endsWith(".crdownload"));
        return nf || null;
      }, 45000);
    }
  }
  if (!file) {
    const st = evalJS(`JSON.stringify((document.body.innerText.match(/下载失败|重新下载|支付|余额不足/g)||[]).slice(0,4))`);
    return { ok: false, reason: "no_file", pageState: st, confirmed };
  }
  // 6. 等 .crdownload 完成
  for (let i = 0; i < 40; i++) {
    if (!fs.existsSync(path.join(DL_DIR, file + ".crdownload"))) break;
    await sleep(1000);
  }
  const srcPath = path.join(DL_DIR, file);
  if (!fs.existsSync(srcPath)) return { ok: false, reason: "download_incomplete", file };
  // 7. 归档：zip 解压到子文件夹，其余直接放年级目录
  const gradeDir = path.join(BASE, grade);
  fs.mkdirSync(gradeDir, { recursive: true });
  const ext = path.extname(file).toLowerCase();
  const baseName = file.replace(/\.[^.]+$/, "").replace(/\s+/g, " ").trim();
  let result;
  if (ext === ".zip") {
    const destDir = path.join(gradeDir, baseName.slice(0, 70).replace(/[\\/:*?"<>|]/g, " ").trim());
    try {
      const names = extractZip(srcPath, destDir);
      result = { ok: true, type: "zip", folder: path.basename(destDir), files: names };
    } catch (e) {
      // 解压失败则保留 zip
      const dest = path.join(gradeDir, path.basename(file));
      fs.copyFileSync(srcPath, dest);
      result = { ok: true, type: "zip_kept", file: path.basename(file), extractError: String(e).slice(0, 120) };
    }
  } else {
    let destName = file;
    let d = path.join(gradeDir, destName);
    let idx = 2;
    while (fs.existsSync(d)) { d = path.join(gradeDir, `${baseName}_${idx}${ext}`); idx++; }
    fs.copyFileSync(srcPath, d);
    result = { ok: true, type: ext.slice(1), file: path.basename(d), size: fs.statSync(d).size };
  }
  try { fs.unlinkSync(srcPath); } catch {}
  return result;
}

async function main() {
  const all = JSON.parse(fs.readFileSync(LIST_FILE, "utf8"));
  const log = loadLog();
  for (const grade of Object.keys(all)) {
    for (const item of all[grade]) {
      if (log.done[item.id]) { console.log(`[${item.id}] skip (done)`); continue; }
      if (log.failed[item.id]) { console.log(`[${item.id}] skip (failed: ${log.failed[item.id].reason})`); continue; }
      console.log(`[${item.id}] downloading: ${item.title.slice(0, 45)}`);
      let r;
      try { r = await downloadOne(item, grade); }
      catch (e) { r = { ok: false, reason: "exception", error: String(e).slice(0, 200) }; }
      console.log(`[${item.id}] => ${JSON.stringify(r).slice(0, 220)}`);
      if (r.ok) log.done[item.id] = { grade, title: item.title, ...r };
      else log.failed[item.id] = { grade, title: item.title, ...r };
      saveLog(log);
      // 慢速模式（用户要求）：每份下载后强制等待 ≥70 秒，避免触发风控
      const wait = 70000 + Math.floor(Math.random() * 10000);
      console.log(`[pace] 等待 ${Math.round(wait / 1000)}s 后继续下一份`);
      await sleep(wait);
    }
  }
  console.log("ALL_DONE");
}
main().catch((e) => { console.error("FATAL", e); process.exit(1); });
