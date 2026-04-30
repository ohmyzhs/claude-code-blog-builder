#!/usr/bin/env node
/**
 * generate-images.js
 *
 * image-designer 에이전트가 작성한 4종 HTML을 headless Chrome 으로 캡처하여 PNG로 저장.
 * 외부 의존성 0 — 시스템에 설치된 Chrome 또는 Edge 의 실행 파일을 직접 호출.
 *
 * Usage:
 *   node scripts/generate-images.js \
 *     --input  "output/2026-04-30_my-keyword/images/_html" \
 *     --output "output/2026-04-30_my-keyword/images"
 *
 * 입력 디렉토리(<input>)는 image-designer 가 작성한 다음 4개 파일을 포함해야 함:
 *   thumbnail.html, infographic.html, quote-card.html, process.html
 *
 * 각 HTML 파일의 <head> 에 캡처 사이즈를 지정할 수 있음:
 *   <meta name="capture-size" content="1200x675">
 *
 * 메타가 없으면 파일명 기반 기본값 사용 (DEFAULT_SIZES 참조).
 *
 * 결과: <output>/{thumbnail,infographic,quote-card,process}.png
 */

import { readFile, readdir, mkdir, stat, access } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import { spawn } from 'node:child_process';
import { join, resolve, basename } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';

// ────────────────────────────────────────────────
// 설정
// ────────────────────────────────────────────────

const DEFAULT_SIZES = {
  'thumbnail.html':   { width: 1200, height: 675  },  // 16:9
  'infographic.html': { width: 1080, height: 1620 },  // 2:3
  'quote-card.html':  { width: 1080, height: 1080 },  // 1:1
  'process.html':     { width: 1200, height: 900  },  // 4:3
};

const CHROME_TIMEOUT_MS = 60_000;

// ────────────────────────────────────────────────
// CLI 파싱
// ────────────────────────────────────────────────

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) {
        args[key] = next;
        i++;
      } else {
        args[key] = true;
      }
    }
  }
  return args;
}

// ────────────────────────────────────────────────
// Chrome / Edge 실행 파일 자동 탐지
// ────────────────────────────────────────────────

async function fileExists(p) {
  try {
    await access(p, fsConstants.X_OK);
    return true;
  } catch {
    try {
      await access(p, fsConstants.R_OK);
      return true;
    } catch {
      return false;
    }
  }
}

async function findChrome() {
  // 1) 환경변수 우선
  if (process.env.CHROME_PATH && (await fileExists(process.env.CHROME_PATH))) {
    return process.env.CHROME_PATH;
  }

  const candidates = [];

  if (process.platform === 'win32') {
    const pf = process.env['ProgramFiles']        || 'C:\\Program Files';
    const pfx = process.env['ProgramFiles(x86)']  || 'C:\\Program Files (x86)';
    const local = process.env['LOCALAPPDATA']     || '';
    candidates.push(
      `${pf}\\Google\\Chrome\\Application\\chrome.exe`,
      `${pfx}\\Google\\Chrome\\Application\\chrome.exe`,
      local && `${local}\\Google\\Chrome\\Application\\chrome.exe`,
      `${pf}\\Microsoft\\Edge\\Application\\msedge.exe`,
      `${pfx}\\Microsoft\\Edge\\Application\\msedge.exe`,
    );
  } else if (process.platform === 'darwin') {
    candidates.push(
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
    );
  } else {
    candidates.push(
      '/usr/bin/google-chrome',
      '/usr/bin/google-chrome-stable',
      '/usr/bin/chromium',
      '/usr/bin/chromium-browser',
      '/usr/bin/microsoft-edge',
      '/snap/bin/chromium',
    );
  }

  for (const c of candidates.filter(Boolean)) {
    if (await fileExists(c)) return c;
  }
  return null;
}

// ────────────────────────────────────────────────
// HTML 메타에서 capture-size 추출
// ────────────────────────────────────────────────

function readCaptureSize(html, filename) {
  const m = html.match(
    /<meta\s+name=["']capture-size["']\s+content=["'](\d+)x(\d+)["'][^>]*>/i,
  );
  if (m) {
    return { width: parseInt(m[1], 10), height: parseInt(m[2], 10) };
  }
  return DEFAULT_SIZES[filename] || { width: 1200, height: 675 };
}

// ────────────────────────────────────────────────
// Chrome headless 캡처 1회 실행
// ────────────────────────────────────────────────

function captureOne({ chromePath, htmlPath, pngPath, width, height }) {
  return new Promise((res, rej) => {
    const fileUrl = pathToFileURL(resolve(htmlPath)).href;

    // 폰트(Google Fonts CDN) 로드 시간 확보 + 약간의 추가 대기
    const args = [
      '--headless=new',
      '--disable-gpu',
      '--hide-scrollbars',
      '--no-sandbox',
      '--disable-dev-shm-usage',
      `--window-size=${width},${height}`,
      `--screenshot=${resolve(pngPath)}`,
      '--virtual-time-budget=10000',  // 폰트·CSS 로드 대기 (ms)
      '--default-background-color=00000000',
      fileUrl,
    ];

    const child = spawn(chromePath, args, { windowsHide: true });

    let stderr = '';
    child.stderr.on('data', (b) => (stderr += b.toString()));

    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      rej(new Error(`Chrome timeout (${CHROME_TIMEOUT_MS}ms): ${htmlPath}`));
    }, CHROME_TIMEOUT_MS);

    child.on('error', (e) => {
      clearTimeout(timer);
      rej(e);
    });

    child.on('exit', (code) => {
      clearTimeout(timer);
      if (code === 0) res();
      else rej(new Error(`Chrome exited ${code}\n${stderr.slice(0, 600)}`));
    });
  });
}

// ────────────────────────────────────────────────
// 메인
// ────────────────────────────────────────────────

async function main() {
  const args = parseArgs(process.argv);
  const inputDir = args.input;
  const outputDir = args.output;

  if (!inputDir || !outputDir) {
    console.error(
      'Usage: node scripts/generate-images.js --input <html_dir> --output <png_dir>',
    );
    process.exit(2);
  }

  // 입력 디렉토리 검증
  try {
    const s = await stat(inputDir);
    if (!s.isDirectory()) throw new Error('not a directory');
  } catch {
    console.error(`ERROR: --input '${inputDir}' 가 디렉토리가 아닙니다.`);
    console.error(
      `먼저 image-designer 에이전트를 실행해서 4개 HTML 파일을 작성하세요.`,
    );
    process.exit(1);
  }

  // Chrome 탐지
  const chromePath = await findChrome();
  if (!chromePath) {
    console.error('ERROR: Chrome 또는 Edge 를 찾지 못했습니다.');
    console.error('해결:');
    console.error('  - Windows: Google Chrome 또는 Microsoft Edge 설치');
    console.error('  - Mac    : Google Chrome 설치 (/Applications)');
    console.error('  - Linux  : apt install chromium-browser  또는  google-chrome');
    console.error('  - 또는 환경변수 CHROME_PATH 로 직접 지정');
    process.exit(1);
  }
  console.log(`browser: ${chromePath}\n`);

  await mkdir(outputDir, { recursive: true });

  // 입력 디렉토리에서 *.html 수집
  const entries = await readdir(inputDir);
  const htmlFiles = entries.filter((f) => f.toLowerCase().endsWith('.html'));

  if (htmlFiles.length === 0) {
    console.error(`ERROR: '${inputDir}' 에 .html 파일이 없습니다.`);
    process.exit(1);
  }

  let okCount = 0;
  const errors = [];

  for (const filename of htmlFiles) {
    const htmlPath = join(inputDir, filename);
    const pngName = filename.replace(/\.html?$/i, '.png');
    const pngPath = join(outputDir, pngName);

    try {
      const html = await readFile(htmlPath, 'utf-8');
      const { width, height } = readCaptureSize(html, basename(filename));

      console.log(`[capture] ${filename}  →  ${pngName}  (${width}×${height})`);
      await captureOne({ chromePath, htmlPath, pngPath, width, height });

      const stats = await stat(pngPath).catch(() => null);
      const bytes = stats ? stats.size : 0;
      if (bytes < 1000) {
        throw new Error(`PNG 파일이 너무 작음 (${bytes} bytes) — 캡처 실패 가능`);
      }
      console.log(`  ✓ ${pngPath}  (${(bytes / 1024).toFixed(1)} KB)`);
      okCount++;
    } catch (e) {
      console.error(`  ✗ ${filename}: ${e.message}`);
      errors.push({ filename, error: e.message });
    }
  }

  console.log(
    `\nDone: ${okCount}/${htmlFiles.length} images captured to ${outputDir}`,
  );

  if (errors.length === htmlFiles.length) {
    console.error('\n전체 실패. 위 에러 메시지를 확인하세요.');
    process.exit(1);
  }
  if (errors.length > 0) {
    console.error(`\n부분 실패 ${errors.length}건:`);
    for (const e of errors) console.error(`  - ${e.filename}: ${e.error}`);
    process.exit(0); // 부분 성공은 0 (호출자가 실패 파일 수를 stdout 으로 판단)
  }
}

main().catch((e) => {
  console.error('Fatal:', e);
  process.exit(1);
});
