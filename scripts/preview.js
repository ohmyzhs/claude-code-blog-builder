#!/usr/bin/env node
/**
 * 블로그 발행 어시스턴트.
 * 작성된 글 폴더를 받아서 self-contained HTML 미리보기를 생성하고 브라우저로 엽니다.
 *
 * Usage:
 *   node scripts/preview.js --folder output/2026-04-08_my-keyword [--no-open]
 *
 * 생성: <folder>/preview.html
 * 기능:
 *   - 제목/태그/메타설명 카드 (각각 복사 버튼)
 *   - 본문 섹션별 복사 (서식 포함 / 텍스트만)
 *   - 본문의 [IMAGE: 설명] 마커 → 시각 인디케이터 박스 (해당 이미지 썸네일 + 라이트박스 연결)
 *   - 이미지 라이트박스 캐러셀 (← → 키보드, 클립보드 복사, 다운로드, Esc 닫기)
 *   - 이미지 일괄 다운로드
 *   - 발행 체크리스트
 */

import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join, basename } from 'node:path';
import { spawn } from 'node:child_process';
import { platform } from 'node:os';

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

const escapeHtmlAttr = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

// ────────────────────────────────────────────────
// 이미지 파일 정렬 — thumbnail → infographic → quote-card → process 순서
// ────────────────────────────────────────────────
const NATURAL_IMAGE_ORDER = ['thumbnail', 'infographic', 'quote-card', 'process'];

function sortImagesNaturally(images) {
  return [...images].sort((a, b) => {
    const ai = NATURAL_IMAGE_ORDER.indexOf(a.replace(/\.\w+$/, ''));
    const bi = NATURAL_IMAGE_ORDER.indexOf(b.replace(/\.\w+$/, ''));
    const ar = ai === -1 ? 99 : ai;
    const br = bi === -1 ? 99 : bi;
    if (ar !== br) return ar - br;
    return a.localeCompare(b);
  });
}

// ────────────────────────────────────────────────
// post.html 을 <h2> 단위로 섹션 분할
// ────────────────────────────────────────────────
function splitSections(html) {
  const sections = [];
  const h1Match = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/);
  const title = h1Match ? h1Match[1].replace(/<[^>]+>/g, '').trim() : '';

  const parts = html.split(/(?=<h2[^>]*>)/);
  for (const part of parts) {
    const h2 = part.match(/<h2[^>]*>([\s\S]*?)<\/h2>/);
    const heading = h2 ? h2[1].replace(/<[^>]+>/g, '').trim() : '도입부';
    sections.push({ heading, html: part.trim() });
  }
  return { title, sections };
}

// ────────────────────────────────────────────────
// 본문에서 [IMAGE: 설명] 마커 → 시각 인디케이터 div 로 치환
//
// 마커 등장 순서 N 번째 → images[N-1] 와 매핑.
// post.md 에 마커가 없을 수 있으니 post.html 안의 마커도 함께 인식.
// ────────────────────────────────────────────────
const MARKER_PATTERN = /\[\s*(?:IMAGE|Image|IMG|이미지)\s*:\s*([^\]]+?)\s*\]/g;
// 단락 전체가 마커인 경우 — <p> 까지 함께 제거하여 invalid HTML 방지
const SOLO_PARAGRAPH_MARKER = /<p[^>]*>\s*\[\s*(?:IMAGE|Image|IMG|이미지)\s*:\s*([^\]]+?)\s*\]\s*<\/p>/g;

function buildMarkerHtml(idx, desc, images) {
  const img = images[idx];
  const safeDesc = escapeHtmlAttr(desc.trim());
  if (img) {
    return `<div class="img-marker" data-img-index="${idx}" onclick="openLightbox(${idx})" role="button" tabindex="0">
  <div class="img-marker-thumb"><img src="images/${escapeHtmlAttr(img)}" alt=""></div>
  <div class="img-marker-body">
    <div class="img-marker-label">📷 이미지 #${idx + 1} 위치 — <strong>${escapeHtmlAttr(img)}</strong></div>
    <div class="img-marker-desc">${safeDesc}</div>
    <div class="img-marker-hint">클릭해서 크게 보기 · 클립보드 복사</div>
  </div>
</div>`;
  }
  return `<div class="img-marker img-marker-orphan">
  <div class="img-marker-body">
    <div class="img-marker-label">📷 이미지 #${idx + 1} 위치 (해당 이미지 파일 없음)</div>
    <div class="img-marker-desc">${safeDesc}</div>
  </div>
</div>`;
}

function transformImageMarkersInHtml(html, images, startIndex = 0) {
  let counter = startIndex;
  // 1차: 단락 전체가 마커인 경우 — <p> 까지 통째로 치환
  let transformed = html.replace(SOLO_PARAGRAPH_MARKER, (_, desc) => {
    const idx = counter++;
    return buildMarkerHtml(idx, desc, images);
  });
  // 2차: 단락 내 인라인 마커 — div 만 삽입 (드물지만 안전망)
  transformed = transformed.replace(MARKER_PATTERN, (_, desc) => {
    const idx = counter++;
    return buildMarkerHtml(idx, desc, images);
  });
  return { html: transformed, count: counter - startIndex };
}

// ────────────────────────────────────────────────
// post.md 에서 [IMAGE: ...] 마커를 단락 텍스트와 함께 추출
// post.html 에 마커가 없을 때 fallback 으로 사용
// ────────────────────────────────────────────────
function extractMarkersFromMd(md) {
  if (!md) return [];
  const markers = [];
  const lines = md.split(/\r?\n/);
  for (const line of lines) {
    const m = [...line.matchAll(MARKER_PATTERN)];
    for (const match of m) {
      markers.push({ desc: match[1].trim(), line: line.trim() });
    }
  }
  return markers;
}

// post.html 에 마커가 0 개이고 post.md 에는 있을 때, 단락 끝에 마커를 인공 삽입
function injectMarkersFromMd(html, mdMarkers, images) {
  if (mdMarkers.length === 0 || !html) return { html, injected: 0 };

  const paragraphs = html.split(/(<\/p>)/i);
  let injected = 0;
  let nextMarker = 0;

  for (let i = 0; i < paragraphs.length; i++) {
    if (paragraphs[i] !== '</p>' && paragraphs[i + 1] === '</p>') {
      const plain = paragraphs[i].replace(/<[^>]+>/g, '');
      const md = mdMarkers[nextMarker];
      if (md) {
        // 단락의 plain text 가 mdMarker.line의 일부와 매칭되면 그 단락 끝에 마커 삽입
        const stripped = md.line.replace(MARKER_PATTERN, '').trim().slice(0, 30);
        if (stripped && plain.includes(stripped.slice(0, Math.min(10, stripped.length)))) {
          paragraphs[i] += `</p>[IMAGE: ${md.desc}]<p>`;
          paragraphs[i + 1] = '';
          injected++;
          nextMarker++;
        }
      }
    }
  }

  // 매칭 실패한 마커는 본문 끝에 한꺼번에 추가
  let result = paragraphs.filter(Boolean).join('');
  while (nextMarker < mdMarkers.length) {
    result += `\n<p>[IMAGE: ${mdMarkers[nextMarker].desc}]</p>`;
    nextMarker++;
    injected++;
  }
  return { html: result, injected };
}

// ────────────────────────────────────────────────
// post.md 를 ## 헤딩 단위로 섹션 분할 (post.html 의 splitSections 와 인덱스 매칭)
// 도입부(첫 ## 이전)는 1번 섹션, 그 후 ## 가 새 섹션. # h1 은 무시 (제목은 별도 처리).
// ────────────────────────────────────────────────
function splitMdSections(md) {
  if (!md) return null;
  const sections = [];
  const lines = md.split(/\r?\n/);
  let currentHeading = '도입부';
  let currentBody = [];
  for (const line of lines) {
    const h2m = line.match(/^##\s+(.+?)\s*$/);
    const h1m = line.match(/^#\s+(.+?)\s*$/);
    if (h2m) {
      if (currentBody.join('\n').trim() !== '' || sections.length > 0) {
        sections.push({ heading: currentHeading, md: currentBody.join('\n').trim() });
      }
      currentHeading = h2m[1].trim();
      currentBody = [];
    } else if (h1m) {
      // h1 은 제목 — 본문에서 제외
    } else {
      currentBody.push(line);
    }
  }
  if (currentBody.join('\n').trim() !== '' || sections.length > 0) {
    sections.push({ heading: currentHeading, md: currentBody.join('\n').trim() });
  }
  return sections;
}

// post.md 의 N 번째 섹션을 가져오기. 헤딩이 일치하지 않으면 인덱스로 fallback.
function getMdSectionFor(htmlSection, mdSections, idx) {
  if (!mdSections || mdSections.length === 0) return null;
  // 헤딩 매칭 우선
  const byHeading = mdSections.find((m) => m.heading === htmlSection.heading);
  if (byHeading) return byHeading.md;
  // 인덱스 fallback
  if (mdSections[idx]) return mdSections[idx].md;
  return null;
}

// ────────────────────────────────────────────────
// HTML → Markdown 변환 (post.md 가 없을 때 워드프레스용 fallback)
// 표·헤딩·리스트·강조·이미지 마커를 마크다운으로 변환.
// ────────────────────────────────────────────────
function htmlToMarkdown(html) {
  let md = html;

  // 표 — | col | col | + 구분선
  md = md.replace(/<table[\s\S]*?<\/table>/gi, (tbl) => {
    const out = [];
    let headerRendered = false;
    const trMatches = tbl.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi);
    for (const tr of trMatches) {
      const cells = [];
      const cellMatches = tr[1].matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/gi);
      for (const c of cellMatches) {
        cells.push(c[1].replace(/<[^>]+>/g, '').replace(/\|/g, '\\|').trim());
      }
      if (cells.length === 0) continue;
      out.push('| ' + cells.join(' | ') + ' |');
      if (!headerRendered) {
        out.push('| ' + cells.map(() => '---').join(' | ') + ' |');
        headerRendered = true;
      }
    }
    return '\n\n' + out.join('\n') + '\n\n';
  });

  // 마커 div 가 들어와 있으면 [IMAGE: 설명] 텍스트로 환원
  md = md.replace(
    /<div[^>]*class="img-marker[^"]*"[\s\S]*?<\/div>\s*<\/div>/gi,
    (m) => {
      const desc = m.match(/img-marker-desc[^>]*>([\s\S]*?)<\/div/);
      const text = desc ? desc[1].replace(/<[^>]+>/g, '').trim() : '';
      return `\n\n[IMAGE: ${text}]\n\n`;
    },
  );

  // 헤딩
  md = md.replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, '\n\n# $1\n\n');
  md = md.replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, '\n\n## $1\n\n');
  md = md.replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, '\n\n### $1\n\n');
  md = md.replace(/<h4[^>]*>([\s\S]*?)<\/h4>/gi, '\n\n#### $1\n\n');

  // 강조
  md = md.replace(/<(strong|b)[^>]*>([\s\S]*?)<\/\1>/gi, '**$2**');
  md = md.replace(/<(em|i)[^>]*>([\s\S]*?)<\/\1>/gi, '*$2*');
  md = md.replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, '`$1`');

  // 링크
  md = md.replace(/<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, '[$2]($1)');

  // 리스트 — ul / ol
  md = md.replace(/<ul[^>]*>([\s\S]*?)<\/ul>/gi, (_, inner) => {
    return '\n' + inner.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_, li) => {
      return '- ' + li.replace(/<[^>]+>/g, '').trim() + '\n';
    }) + '\n';
  });
  md = md.replace(/<ol[^>]*>([\s\S]*?)<\/ol>/gi, (_, inner) => {
    let n = 0;
    return '\n' + inner.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_, li) => {
      n++;
      return n + '. ' + li.replace(/<[^>]+>/g, '').trim() + '\n';
    }) + '\n';
  });

  // hr / br / p
  md = md.replace(/<hr\s*\/?>/gi, '\n\n---\n\n');
  md = md.replace(/<br\s*\/?>/gi, '\n');
  md = md.replace(/<p[^>]*>/gi, '');
  md = md.replace(/<\/p>/gi, '\n\n');

  // 남은 태그 제거
  md = md.replace(/<[^>]+>/g, '');

  // 엔티티
  md = md
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");

  // 빈 줄 정리
  md = md.replace(/\n{3,}/g, '\n\n').trim();
  return md;
}

// ────────────────────────────────────────────────
// 블로그스팟용 HTML — 깨끗한 의미론적 HTML.
// HTML 보기 모드에 그대로 붙여넣을 수 있도록 class/style/data-* 속성 제거,
// h1-h3 / 표 / 리스트 / strong / em 모두 보존.
// 이미지 마커는 [IMAGE: 설명] 텍스트로 환원.
// ────────────────────────────────────────────────
function cleanHtmlForBlogger(html) {
  let out = html;
  // 마커 div → [IMAGE: ...] 단락
  out = out.replace(
    /<div[^>]*class="img-marker[^"]*"[\s\S]*?<\/div>\s*<\/div>/gi,
    (m) => {
      const desc = m.match(/img-marker-desc[^>]*>([\s\S]*?)<\/div/);
      const text = desc ? desc[1].replace(/<[^>]+>/g, '').trim() : '';
      return `<p>[IMAGE: ${text}]</p>`;
    },
  );
  // class / style / data-* / onclick 등 비-의미 속성 제거
  out = out.replace(/\s(?:class|style|onclick|tabindex|role|data-[^=]+)="[^"]*"/gi, '');
  // 빈 단락 정리
  out = out.replace(/<p[^>]*>\s*<\/p>/gi, '');
  // 연속 공백 정리
  out = out.replace(/\n{3,}/g, '\n\n');
  return out.trim();
}

// ────────────────────────────────────────────────
// HTML 정규화 — 네이버 스마트에디터 페이스트 친화
// (h1 제거, h2/h3는 굵은 단락, 표는 텍스트 단락)
// 이미지 마커는 그대로 텍스트로 유지 (사용자가 발행 시 그 위치에 이미지를 직접 업로드)
// ────────────────────────────────────────────────
function normalizeForPaste(html) {
  let out = html;

  // 표를 텍스트 단락으로 변환
  out = out.replace(/<table[\s\S]*?<\/table>/gi, (tbl) => {
    const rows = [];
    const trMatches = tbl.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi);
    for (const tr of trMatches) {
      const cells = [];
      const cellMatches = tr[1].matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/gi);
      for (const c of cellMatches) {
        cells.push(c[1].replace(/<[^>]+>/g, '').trim());
      }
      if (cells.length) rows.push(cells.join(' | '));
    }
    return (
      '<p><strong>[표]</strong></p>' +
      rows.map((r) => `<p>${r}</p>`).join('') +
      '<p><br></p>'
    );
  });

  // 이미지 마커 div 가 normalize 단계에 들어오면 텍스트로 환원
  out = out.replace(
    /<div[^>]*class="img-marker[^"]*"[\s\S]*?<\/div>\s*<\/div>/gi,
    (m) => {
      const desc = m.match(/img-marker-desc[^>]*>([\s\S]*?)<\/div/);
      const text = desc ? desc[1].replace(/<[^>]+>/g, '').trim() : '';
      return `<p>[IMAGE: ${text}]</p>`;
    },
  );

  out = out.replace(/<h1[^>]*>[\s\S]*?<\/h1>/gi, '');
  out = out.replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, '<p><br></p><p><strong>$1</strong></p>');
  out = out.replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, '<p><strong>$1</strong></p>');
  out = out.replace(/<hr\s*\/?>/gi, '<p><br></p>');
  out = out.replace(/(<p><br><\/p>\s*){3,}/gi, '<p><br></p><p><br></p>');

  return out.trim();
}

function htmlToPlain(html) {
  return html
    .replace(/<table[\s\S]*?<\/table>/gi, (tbl) => {
      const rows = [];
      const trMatches = tbl.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi);
      for (const tr of trMatches) {
        const cells = [];
        const cellMatches = tr[1].matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/gi);
        for (const c of cellMatches) {
          cells.push(c[1].replace(/<[^>]+>/g, '').trim());
        }
        rows.push(cells.join(' | '));
      }
      return '\n[표]\n' + rows.join('\n') + '\n';
    })
    .replace(
      /<div[^>]*class="img-marker[^"]*"[\s\S]*?<\/div>\s*<\/div>/gi,
      (m) => {
        const desc = m.match(/img-marker-desc[^>]*>([\s\S]*?)<\/div/);
        const text = desc ? desc[1].replace(/<[^>]+>/g, '').trim() : '';
        return `\n[IMAGE: ${text}]\n`;
      },
    )
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<li[^>]*>/gi, '• ')
    .replace(/<\/h[1-6]>/gi, '\n')
    .replace(/<h[1-6][^>]*>/gi, '')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function renderPreviewHtml({ folder, title, meta, sections, images, markerCount, mdSections }) {
  // 4종 포맷을 각 섹션마다 미리 계산:
  //  - naverHtml  : 네이버 스마트에디터에 rich-text 로 붙여넣음 (선택→execCommand)
  //  - bloggerHtml: 블로그스팟 HTML 보기에 raw HTML 텍스트로 붙여넣음
  //  - wpMarkdown : 워드프레스 블록 에디터(Gutenberg)에 마크다운 텍스트로 붙여넣음
  //  - plain      : 어디서든 fallback
  // 모두 마커 변환 *전* 원본 HTML 기준 — [IMAGE: 설명] 텍스트가 보존되어 사용자가 발행 시 그 위치에 이미지를 직접 업로드.
  const sectionsData = sections.map((s, i) => {
    const mdRaw = getMdSectionFor(s, mdSections, i);
    const wpMarkdown = mdRaw && mdRaw.trim() ? mdRaw : htmlToMarkdown(s.html);
    return {
      heading: s.heading,
      naverHtml: normalizeForPaste(s.html),
      bloggerHtml: cleanHtmlForBlogger(s.html),
      wpMarkdown,
      plain: htmlToPlain(s.html),
    };
  });

  const sectionsHtml = sections
    .map((s, i) => `
<div class="section">
  <div class="section-head">
    <div class="section-title-row">
      <span class="section-num">${i + 1}</span>
      <h3>${escapeHtmlAttr(s.heading)}</h3>
    </div>
    <div class="section-actions">
      <button class="btn-naver" onclick="copyNaver(${i}, this)" title="네이버 스마트에디터에 그대로 붙여넣기 (rich-text)">📋 네이버</button>
      <button class="btn-blogger" onclick="copyBlogger(${i}, this)" title="블로그스팟의 HTML 보기 모드에 붙여넣기 (raw HTML 소스)">📋 블로그스팟</button>
      <button class="btn-wp" onclick="copyWordpress(${i}, this)" title="워드프레스 블록 에디터(Gutenberg)에 붙여넣기 (마크다운)">📋 WordPress</button>
      <button class="btn-plain" onclick="copyPlain(${i}, this)" title="순수 텍스트 — 어디서든 fallback">📝 텍스트</button>
    </div>
  </div>
  <div class="section-body">${s.preview}</div>
</div>`)
    .join('\n');

  const formatHelp = `
<div class="format-help">
  <details>
    <summary>📋 어떤 복사 모드를 골라야 하나요?</summary>
    <div class="format-help-body">
      <div class="format-row">
        <strong class="badge-naver">네이버</strong>
        <div>스마트에디터 본문에 그대로 붙여넣기. 굵게·리스트·헤딩(굵은 단락으로 변환)이 살아있고 표는 텍스트로 변환됩니다(스마트에디터에서 직접 표 그리는 게 깔끔).</div>
      </div>
      <div class="format-row">
        <strong class="badge-blogger">블로그스팟</strong>
        <div>Blogger 에디터 우상단의 <strong>HTML 보기</strong> 토글 → 그 화면에 붙여넣기. h1~h3·표·리스트가 모두 그대로 보존됩니다.</div>
      </div>
      <div class="format-row">
        <strong class="badge-wp">WordPress</strong>
        <div>새 글의 블록 에디터(Gutenberg) 본문에 마크다운을 붙여넣기 — <code>##</code>·<code>**</code>·표·리스트가 자동으로 블록으로 변환됩니다. Classic Editor 면 비주얼 모드 대신 텍스트(코드) 모드에 붙여넣으세요.</div>
      </div>
      <div class="format-row">
        <strong class="badge-plain">텍스트</strong>
        <div>위 셋이 모두 안 통하는 곳을 위한 순수 텍스트. 서식·표·리스트 모두 사라지고 줄바꿈만 남습니다.</div>
      </div>
      <div class="format-note">
        본문의 <code>[IMAGE: 설명]</code> 자리에는 어느 모드든 그 텍스트가 그대로 들어갑니다 — 발행 시 그 위치에 이미지를 직접 업로드하라는 표시예요.
      </div>
    </div>
  </details>
</div>`;

  const metaInline = {
    title: title,
    description: meta.meta_description || '',
    tags: (meta.tags || []).map((t) => '#' + t).join(' '),
  };

  // 사이드바 이미지 카드 — 클릭 시 라이트박스 열기
  const imagesHtml = images
    .map(
      (img, i) => `
<div class="img-card" onclick="openLightbox(${i})" role="button" tabindex="0">
  <img src="images/${escapeHtmlAttr(img)}" alt="${escapeHtmlAttr(img)}" />
  <div class="img-meta">
    <span>${i + 1}. ${escapeHtmlAttr(img)}</span>
    <a href="images/${escapeHtmlAttr(img)}" download="${escapeHtmlAttr(img)}" onclick="event.stopPropagation()">⬇</a>
  </div>
</div>`
    )
    .join('\n');

  const tagsHtml = (meta.tags || [])
    .map((t) => `<span class="tag">#${escapeHtmlAttr(t)}</span>`)
    .join(' ');

  const markerWarning =
    markerCount === 0
      ? `<div class="warn-banner">⚠ 본문에서 <code>[IMAGE: ...]</code> 마커를 찾지 못했습니다. blog-writer 가 마커를 본문에 표시했는지 확인하세요 (CLAUDE.md 권장: 최소 4개).</div>`
      : '';

  return `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <title>발행 어시스턴트 — ${escapeHtmlAttr(title)}</title>
  <style>
    :root {
      --bg: #f7f6f2;
      --card: #ffffff;
      --fg: #1a1a1a;
      --muted: #6b6b6b;
      --accent: #d97a3a;
      --border: #e7e5dd;
      --ok: #2d8a4e;
      --warn-bg: #fef3e8;
      --warn-fg: #8a4a14;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; min-width: 0; }
    html, body { width: 100%; overflow-x: hidden; }
    body {
      font-family: 'Pretendard', 'Apple SD Gothic Neo', -apple-system, sans-serif;
      background: var(--bg);
      color: var(--fg);
      line-height: 1.7;
      word-break: keep-all;
      overflow-wrap: anywhere;
    }

    .topbar {
      position: sticky;
      top: 0;
      background: var(--fg);
      color: var(--bg);
      padding: 14px 24px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 16px;
      z-index: 100;
      box-shadow: 0 2px 10px rgba(0,0,0,0.1);
    }
    .topbar h1 {
      font-size: 14px;
      font-weight: 700;
      letter-spacing: 0.02em;
      flex: 1;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .topbar .brand { font-size: 11px; opacity: 0.7; letter-spacing: 0.15em; flex-shrink: 0; }

    main {
      max-width: 1320px;
      margin: 0 auto;
      padding: 24px;
      display: grid;
      grid-template-columns: minmax(0, 1fr) 340px;
      gap: 24px;
      align-items: start;
    }
    @media (max-width: 1100px) {
      main { grid-template-columns: minmax(0, 1fr); }
      .col-side { order: -1; }
    }
    @media (max-width: 600px) {
      main { padding: 16px; gap: 16px; }
      .topbar { padding: 12px 16px; }
    }
    .col-main { min-width: 0; }
    .col-side { display: flex; flex-direction: column; gap: 16px; min-width: 0; }

    .card {
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 20px;
      min-width: 0;
    }
    .card h2 {
      font-size: 12px;
      letter-spacing: 0.08em;
      color: var(--accent);
      margin-bottom: 14px;
      text-transform: uppercase;
      font-weight: 700;
    }

    .meta-row { margin-bottom: 18px; }
    .meta-row:last-child { margin-bottom: 0; }
    .meta-row label {
      display: block;
      font-size: 11px;
      color: var(--muted);
      margin-bottom: 6px;
      font-weight: 600;
    }
    .meta-row .val { display: flex; flex-direction: column; gap: 8px; }
    .meta-row .val .text { font-size: 14px; line-height: 1.5; color: var(--fg); }
    .meta-row .val .tags-wrap { display: flex; flex-wrap: wrap; gap: 4px; }

    button, .btn {
      background: var(--fg);
      color: var(--bg);
      border: none;
      padding: 8px 14px;
      border-radius: 6px;
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
      font-family: inherit;
      transition: background 0.15s, transform 0.1s;
    }
    button:hover { background: var(--accent); }
    button:active { transform: scale(0.97); }
    button.copied { background: var(--ok) !important; }
    .btn-row { display: flex; gap: 6px; flex-wrap: wrap; }
    .btn-self { align-self: flex-start; }

    .tag {
      display: inline-block;
      padding: 4px 10px;
      background: var(--bg);
      border: 1px solid var(--border);
      border-radius: 99px;
      font-size: 12px;
      color: var(--muted);
    }

    .warn-banner {
      background: var(--warn-bg);
      color: var(--warn-fg);
      border: 1px solid #f4d4af;
      border-radius: 8px;
      padding: 12px 16px;
      font-size: 13px;
      margin-bottom: 16px;
    }
    .warn-banner code {
      background: rgba(0,0,0,0.06);
      padding: 1px 6px;
      border-radius: 4px;
      font-size: 12px;
    }

    /* ───── Sections ───── */
    .section {
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: 12px;
      margin-bottom: 16px;
      overflow: hidden;
    }
    .section-head {
      display: flex;
      flex-direction: column;
      gap: 14px;
      padding: 18px 22px 16px;
      background: #fafaf6;
      border-bottom: 1px solid var(--border);
    }
    .section-title-row { display: flex; align-items: flex-start; gap: 12px; width: 100%; }
    .section-num {
      width: 28px;
      height: 28px;
      border-radius: 50%;
      background: var(--accent);
      color: white;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 13px;
      font-weight: 700;
      flex-shrink: 0;
      margin-top: 2px;
    }
    .section-head h3 {
      flex: 1;
      min-width: 0;
      font-size: 17px;
      font-weight: 700;
      line-height: 1.45;
      color: var(--fg);
      word-break: keep-all;
      overflow-wrap: anywhere;
    }
    .section-actions { display: flex; gap: 6px; flex-wrap: wrap; width: 100%; }
    .section-actions button {
      flex: 1 1 calc(25% - 6px);
      min-width: 110px;
      padding: 8px 10px;
      font-size: 12px;
    }
    .section-actions .btn-naver { border-left: 3px solid #03C75A; }
    .section-actions .btn-naver:hover { background: #03C75A; }
    .section-actions .btn-blogger { border-left: 3px solid #FF7E29; }
    .section-actions .btn-blogger:hover { background: #FF7E29; }
    .section-actions .btn-wp { border-left: 3px solid #21759B; }
    .section-actions .btn-wp:hover { background: #21759B; }
    .section-actions .btn-plain { border-left: 3px solid var(--muted); }
    .section-actions .btn-plain:hover { background: var(--muted); }

    /* ───── 포맷 도움말 ───── */
    .format-help {
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: 12px;
      margin-bottom: 16px;
      overflow: hidden;
    }
    .format-help summary {
      cursor: pointer;
      padding: 14px 20px;
      font-size: 13px;
      font-weight: 600;
      color: var(--fg);
      list-style: none;
      user-select: none;
    }
    .format-help summary::-webkit-details-marker { display: none; }
    .format-help summary::before {
      content: '▸';
      display: inline-block;
      margin-right: 8px;
      transition: transform 0.15s;
      color: var(--accent);
    }
    .format-help[open] summary::before { transform: rotate(90deg); }
    .format-help summary:hover { background: #fafaf6; }
    .format-help-body {
      padding: 4px 20px 18px;
      display: flex;
      flex-direction: column;
      gap: 12px;
      font-size: 13px;
      line-height: 1.6;
    }
    .format-help .format-row {
      display: flex;
      gap: 12px;
      align-items: flex-start;
    }
    .format-help .format-row > strong {
      flex: 0 0 88px;
      padding: 3px 8px;
      border-radius: 6px;
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.02em;
      text-align: center;
      color: white;
    }
    .badge-naver { background: #03C75A; }
    .badge-blogger { background: #FF7E29; }
    .badge-wp { background: #21759B; }
    .badge-plain { background: var(--muted); }
    .format-help code {
      background: rgba(0,0,0,0.06);
      padding: 1px 6px;
      border-radius: 4px;
      font-size: 12px;
      font-family: 'SF Mono', 'Consolas', monospace;
    }
    .format-note {
      margin-top: 4px;
      padding-top: 12px;
      border-top: 1px dashed var(--border);
      color: var(--muted);
      font-size: 12px;
    }

    .section-body { padding: 24px; font-size: 15px; }
    .section-body > * { max-width: 100%; }
    .section-body h1 { font-size: 22px; margin-bottom: 14px; line-height: 1.4; }
    .section-body h2 { font-size: 18px; margin: 22px 0 12px; line-height: 1.4; }
    .section-body p { margin-bottom: 14px; }
    .section-body strong, .section-body b { font-weight: 700; color: var(--fg); }
    .section-body ul, .section-body ol { padding-left: 22px; margin-bottom: 14px; }
    .section-body li { margin-bottom: 6px; }

    .section-body table {
      display: block;
      width: 100%;
      max-width: 100%;
      overflow-x: auto;
      border-collapse: collapse;
      margin: 14px 0;
      font-size: 14px;
      white-space: normal;
    }
    .section-body th, .section-body td {
      border: 1px solid var(--border);
      padding: 8px 12px;
      text-align: left;
      vertical-align: top;
    }
    .section-body th { background: var(--bg); font-weight: 700; }

    /* ───── Image marker (본문 인디케이터) ───── */
    .img-marker {
      display: flex;
      gap: 14px;
      align-items: stretch;
      margin: 18px 0;
      padding: 14px;
      background: linear-gradient(180deg, #fbf6ec 0%, #f7eedc 100%);
      border: 2px dashed var(--accent);
      border-radius: 10px;
      cursor: pointer;
      transition: transform 0.12s, box-shadow 0.12s;
    }
    .img-marker:hover {
      transform: translateY(-1px);
      box-shadow: 0 4px 14px rgba(217, 122, 58, 0.18);
    }
    .img-marker:focus {
      outline: 3px solid var(--accent);
      outline-offset: 2px;
    }
    .img-marker-thumb {
      flex: 0 0 96px;
      width: 96px;
      height: 96px;
      border-radius: 6px;
      overflow: hidden;
      background: var(--bg);
      border: 1px solid var(--border);
    }
    .img-marker-thumb img {
      width: 100%;
      height: 100%;
      object-fit: cover;
    }
    .img-marker-body {
      flex: 1;
      min-width: 0;
      display: flex;
      flex-direction: column;
      justify-content: center;
      gap: 4px;
    }
    .img-marker-label {
      font-size: 13px;
      font-weight: 700;
      color: var(--warn-fg);
    }
    .img-marker-label strong {
      font-family: 'SF Mono', 'Consolas', monospace;
      font-size: 12px;
      background: rgba(217, 122, 58, 0.15);
      padding: 1px 6px;
      border-radius: 4px;
      color: var(--accent);
    }
    .img-marker-desc {
      font-size: 14px;
      color: var(--fg);
      line-height: 1.45;
    }
    .img-marker-hint {
      font-size: 11px;
      color: var(--muted);
      letter-spacing: 0.02em;
    }
    .img-marker-orphan {
      background: #fff5f5;
      border-color: #c53030;
    }
    .img-marker-orphan .img-marker-label { color: #c53030; }

    /* ───── Image gallery (사이드바) ───── */
    .img-card {
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: 10px;
      overflow: hidden;
      margin-bottom: 12px;
      cursor: pointer;
      transition: transform 0.12s, box-shadow 0.12s;
    }
    .img-card:hover {
      transform: translateY(-1px);
      box-shadow: 0 4px 14px rgba(0,0,0,0.08);
    }
    .img-card:last-child { margin-bottom: 0; }
    .img-card img {
      width: 100%;
      height: auto;
      display: block;
      background: #eee;
      max-height: 200px;
      object-fit: contain;
    }
    .img-meta {
      padding: 10px 14px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-size: 12px;
      color: var(--muted);
      border-top: 1px solid var(--border);
      gap: 8px;
    }
    .img-meta span {
      flex: 1;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .img-meta a {
      color: var(--accent);
      font-weight: 700;
      text-decoration: none;
      flex-shrink: 0;
      padding: 2px 8px;
      border-radius: 4px;
    }
    .img-meta a:hover { background: rgba(217, 122, 58, 0.12); }
    .download-all {
      width: 100%;
      padding: 12px;
      font-size: 13px;
      margin-bottom: 14px;
    }

    /* ───── Lightbox 캐러셀 ───── */
    .lightbox {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.92);
      display: none;
      align-items: center;
      justify-content: center;
      z-index: 1000;
      padding: 40px 80px;
    }
    .lightbox.show { display: flex; }
    .lightbox-stage {
      max-width: 100%;
      max-height: 100%;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 16px;
    }
    .lightbox-img-wrap {
      max-width: 100%;
      max-height: calc(100vh - 200px);
      display: flex;
      align-items: center;
      justify-content: center;
      background: rgba(255,255,255,0.02);
      border-radius: 8px;
    }
    .lightbox-img {
      max-width: 100%;
      max-height: calc(100vh - 200px);
      object-fit: contain;
      display: block;
    }
    .lightbox-info {
      color: rgba(255,255,255,0.85);
      font-size: 13px;
      text-align: center;
      letter-spacing: 0.02em;
    }
    .lightbox-info .filename {
      font-family: 'SF Mono', 'Consolas', monospace;
      font-size: 12px;
      background: rgba(255,255,255,0.1);
      padding: 2px 8px;
      border-radius: 4px;
      margin-left: 8px;
    }
    .lightbox-actions {
      display: flex;
      gap: 10px;
      flex-wrap: wrap;
      justify-content: center;
    }
    .lightbox-actions button {
      background: rgba(255,255,255,0.12);
      color: white;
      padding: 10px 18px;
      font-size: 13px;
      border: 1px solid rgba(255,255,255,0.2);
    }
    .lightbox-actions button:hover { background: var(--accent); border-color: var(--accent); }
    .lightbox-actions button.copied { background: var(--ok) !important; border-color: var(--ok) !important; }
    .lightbox-nav {
      position: absolute;
      top: 50%;
      transform: translateY(-50%);
      width: 56px;
      height: 56px;
      border-radius: 50%;
      background: rgba(255,255,255,0.1);
      color: white;
      border: 1px solid rgba(255,255,255,0.25);
      font-size: 26px;
      font-weight: 700;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: background 0.15s, transform 0.1s;
    }
    .lightbox-nav:hover { background: var(--accent); border-color: var(--accent); }
    .lightbox-nav:active { transform: translateY(-50%) scale(0.94); }
    .lightbox-nav:disabled {
      opacity: 0.25;
      cursor: not-allowed;
      background: rgba(255,255,255,0.05);
    }
    .lightbox-prev { left: 14px; }
    .lightbox-next { right: 14px; }
    .lightbox-close {
      position: absolute;
      top: 16px;
      right: 16px;
      width: 40px;
      height: 40px;
      border-radius: 50%;
      background: rgba(255,255,255,0.12);
      color: white;
      border: 1px solid rgba(255,255,255,0.25);
      font-size: 18px;
      font-weight: 700;
      cursor: pointer;
    }
    .lightbox-close:hover { background: var(--accent); border-color: var(--accent); }
    .lightbox-counter {
      position: absolute;
      top: 22px;
      left: 22px;
      color: rgba(255,255,255,0.7);
      font-size: 13px;
      letter-spacing: 0.02em;
      font-weight: 600;
    }

    @media (max-width: 700px) {
      .lightbox { padding: 60px 12px; }
      .lightbox-nav { width: 44px; height: 44px; font-size: 22px; }
      .lightbox-prev { left: 6px; }
      .lightbox-next { right: 6px; }
    }

    /* ───── Checklist ───── */
    .checklist label {
      display: flex;
      align-items: flex-start;
      gap: 10px;
      padding: 10px 0;
      font-size: 14px;
      cursor: pointer;
      border-bottom: 1px dashed var(--border);
      line-height: 1.5;
    }
    .checklist label:last-child { border-bottom: none; padding-bottom: 0; }
    .checklist label:first-of-type { padding-top: 0; }
    .checklist input[type=checkbox] {
      margin-top: 3px;
      width: 16px;
      height: 16px;
      flex-shrink: 0;
      accent-color: var(--accent);
      cursor: pointer;
    }
    .checklist input:checked + span {
      text-decoration: line-through;
      color: var(--muted);
    }

    /* ───── Toast ───── */
    .toast {
      position: fixed;
      bottom: 24px;
      right: 24px;
      background: var(--ok);
      color: white;
      padding: 12px 22px;
      border-radius: 8px;
      font-size: 13px;
      font-weight: 700;
      opacity: 0;
      transform: translateY(20px);
      transition: all 0.25s;
      pointer-events: none;
      z-index: 2000;
      box-shadow: 0 4px 12px rgba(0,0,0,0.15);
    }
    .toast.show { opacity: 1; transform: translateY(0); }
  </style>
</head>
<body>
  <div class="topbar">
    <h1>📰 발행 어시스턴트 — ${escapeHtmlAttr(folder)}</h1>
    <span class="brand">${escapeHtmlAttr(process.env.BRAND_NAME || 'BLOG')}</span>
  </div>

  <main>
    <div class="col-main">
      ${markerWarning}
      ${formatHelp}
      ${sectionsHtml}
    </div>

    <div class="col-side">
      <div class="card">
        <h2>📋 메타데이터</h2>
        <div class="meta-row">
          <label>제목 (${title.length}자)</label>
          <div class="val">
            <div class="text">${escapeHtmlAttr(title)}</div>
            <button class="btn-self" onclick="copyMeta('title', this)">📋 제목 복사</button>
          </div>
        </div>
        ${
          meta.meta_description
            ? `
        <div class="meta-row">
          <label>메타 설명 (${meta.meta_description.length}자)</label>
          <div class="val">
            <div class="text">${escapeHtmlAttr(meta.meta_description)}</div>
            <button class="btn-self" onclick="copyMeta('description', this)">📋 메타설명 복사</button>
          </div>
        </div>`
            : ''
        }
        <div class="meta-row">
          <label>태그 ${(meta.tags || []).length}개</label>
          <div class="val">
            <div class="tags-wrap">${tagsHtml}</div>
            <button class="btn-self" onclick="copyMeta('tags', this)">📋 태그 전체 복사</button>
          </div>
        </div>
      </div>

      <div class="card">
        <h2>🖼 이미지 ${images.length}장 (클릭하여 크게 보기)</h2>
        ${
          images.length > 1
            ? `<button class="download-all" onclick="downloadAll()">⬇ ${images.length}장 일괄 다운로드</button>`
            : ''
        }
        ${imagesHtml}
      </div>

      <div class="card checklist">
        <h2>✅ 발행 체크리스트</h2>
        <label><input type="checkbox"><span>제목 입력</span></label>
        <label><input type="checkbox"><span>카테고리 선택</span></label>
        <label><input type="checkbox"><span>본문 단락 복사·붙여넣기 (위에서부터 순서대로)</span></label>
        <label><input type="checkbox"><span>표는 스마트에디터에서 직접 생성</span></label>
        <label><input type="checkbox"><span>이미지 ${images.length}장 본문에 업로드 ([IMAGE: ...] 자리에)</span></label>
        <label><input type="checkbox"><span>썸네일 = 대표 이미지로 등록</span></label>
        <label><input type="checkbox"><span>태그 ${(meta.tags || []).length}개 입력</span></label>
        <label><input type="checkbox"><span>맞춤법 검사</span></label>
        <label><input type="checkbox"><span>모바일 미리보기 확인</span></label>
        <label><input type="checkbox"><span>발행 (자동 발행 금지, 사람 검수 필수)</span></label>
      </div>
    </div>
  </main>

  <!-- ───── Lightbox ───── -->
  <div class="lightbox" id="lightbox" onclick="onLightboxBg(event)">
    <button class="lightbox-close" onclick="closeLightbox()" aria-label="닫기 (Esc)">✕</button>
    <div class="lightbox-counter" id="lbCounter">1 / 4</div>
    <button class="lightbox-nav lightbox-prev" id="lbPrev" onclick="prevImage()" aria-label="이전 (←)">‹</button>
    <div class="lightbox-stage">
      <div class="lightbox-img-wrap">
        <img class="lightbox-img" id="lbImg" alt="">
      </div>
      <div class="lightbox-info" id="lbInfo"></div>
      <div class="lightbox-actions">
        <button onclick="copyLightboxImage(this)" id="lbCopyBtn">📋 클립보드로 복사</button>
        <button onclick="downloadLightboxImage()">⬇ 다운로드</button>
      </div>
    </div>
    <button class="lightbox-nav lightbox-next" id="lbNext" onclick="nextImage()" aria-label="다음 (→)">›</button>
  </div>

  <div class="toast" id="toast">복사됨!</div>

  <script id="bootData" type="application/json">${JSON.stringify({ sections: sectionsData, meta: metaInline, images }).replace(/<\/script/gi, '<\\/script')}</script>
  <script>
    const BOOT = JSON.parse(document.getElementById('bootData').textContent);
    const SECTIONS = BOOT.sections;
    const META = BOOT.meta;
    const IMAGES = BOOT.images;

    // ───── Toast & Btn flash ─────
    function showToast(msg, ok = true) {
      const t = document.getElementById('toast');
      t.textContent = msg;
      t.style.background = ok ? 'var(--ok)' : '#c53030';
      t.classList.add('show');
      setTimeout(() => t.classList.remove('show'), 1800);
    }
    function flashBtn(btn, label) {
      const orig = btn.textContent;
      btn.classList.add('copied');
      btn.textContent = label || '✓ 복사됨';
      setTimeout(() => {
        btn.classList.remove('copied');
        btn.textContent = orig;
      }, 1800);
    }

    // ───── Clipboard helpers ─────
    function copyHtmlRich(html) {
      const container = document.createElement('div');
      container.contentEditable = 'true';
      container.innerHTML = html;
      container.style.position = 'fixed';
      container.style.left = '-99999px';
      container.style.top = '0';
      container.style.opacity = '0';
      container.style.whiteSpace = 'pre-wrap';
      document.body.appendChild(container);
      const range = document.createRange();
      range.selectNodeContents(container);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      let success = false;
      try { success = document.execCommand('copy'); } catch { success = false; }
      sel.removeAllRanges();
      document.body.removeChild(container);
      return success;
    }
    function copyPlainText(text) {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        return navigator.clipboard.writeText(text).then(() => true).catch(() => fallbackPlain(text));
      }
      return Promise.resolve(fallbackPlain(text));
    }
    function fallbackPlain(text) {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.left = '-99999px';
      document.body.appendChild(ta);
      ta.select();
      let ok = false;
      try { ok = document.execCommand('copy'); } catch {}
      document.body.removeChild(ta);
      return ok;
    }

    // ───── Section copy — 플랫폼별 4종 ─────

    // 네이버: rich-text via selection (스마트에디터가 selection 기반 paste 를 가장 잘 받음)
    function copyNaver(idx, btn) {
      const s = SECTIONS[idx];
      const ok = copyHtmlRich(s.naverHtml);
      if (ok) { flashBtn(btn); showToast('네이버 서식 복사됨 — 스마트에디터 본문에 그대로 붙여넣으세요'); }
      else { showToast('복사 실패 — 텍스트 모드로 다시 시도해주세요', false); }
    }

    // 블로그스팟: raw HTML 텍스트 (HTML 보기 모드에 paste)
    async function copyBlogger(idx, btn) {
      const s = SECTIONS[idx];
      const ok = await copyPlainText(s.bloggerHtml);
      if (ok) { flashBtn(btn); showToast('HTML 소스 복사됨 — Blogger 의 〈/〉 HTML 보기에 붙여넣으세요'); }
      else { showToast('복사 실패', false); }
    }

    // 워드프레스: 마크다운 텍스트 (Gutenberg/Classic 텍스트 모드에 paste)
    async function copyWordpress(idx, btn) {
      const s = SECTIONS[idx];
      const ok = await copyPlainText(s.wpMarkdown);
      if (ok) { flashBtn(btn); showToast('마크다운 복사됨 — WordPress 블록 에디터에 붙여넣으세요'); }
      else { showToast('복사 실패', false); }
    }

    async function copyPlain(idx, btn) {
      const s = SECTIONS[idx];
      const ok = await copyPlainText(s.plain);
      if (ok) { flashBtn(btn); showToast('텍스트 복사 완료'); }
      else { showToast('복사 실패', false); }
    }
    async function copyMeta(key, btn) {
      const text = META[key] || '';
      const ok = await copyPlainText(text);
      if (ok) { flashBtn(btn); showToast('복사 완료'); }
      else { showToast('복사 실패', false); }
    }

    // ───── Lightbox carousel ─────
    let lbIndex = 0;

    function openLightbox(idx) {
      if (!IMAGES || IMAGES.length === 0) {
        showToast('이미지가 없습니다', false);
        return;
      }
      lbIndex = Math.max(0, Math.min(idx, IMAGES.length - 1));
      renderLightbox();
      document.getElementById('lightbox').classList.add('show');
      document.body.style.overflow = 'hidden';
    }
    function closeLightbox() {
      document.getElementById('lightbox').classList.remove('show');
      document.body.style.overflow = '';
    }
    function onLightboxBg(e) {
      // 배경(어두운 영역) 클릭 시 닫기 — 이미지/버튼 클릭은 통과
      if (e.target.id === 'lightbox') closeLightbox();
    }
    function renderLightbox() {
      const img = IMAGES[lbIndex];
      const el = document.getElementById('lbImg');
      el.src = 'images/' + img;
      el.alt = img;
      document.getElementById('lbInfo').innerHTML =
        '이미지 ' + (lbIndex + 1) + ' / ' + IMAGES.length +
        '<span class="filename">' + img + '</span>';
      document.getElementById('lbCounter').textContent =
        (lbIndex + 1) + ' / ' + IMAGES.length;
      document.getElementById('lbPrev').disabled = (lbIndex === 0);
      document.getElementById('lbNext').disabled = (lbIndex === IMAGES.length - 1);
    }
    function prevImage() {
      if (lbIndex > 0) { lbIndex--; renderLightbox(); }
    }
    function nextImage() {
      if (lbIndex < IMAGES.length - 1) { lbIndex++; renderLightbox(); }
    }
    async function copyLightboxImage(btn) {
      const imgEl = document.getElementById('lbImg');
      // canvas 경유 (file:// 에서도 동일 폴더 이미지면 cross-origin 문제 없음)
      try {
        await new Promise((resolve, reject) => {
          if (imgEl.complete && imgEl.naturalWidth) resolve();
          else { imgEl.onload = resolve; imgEl.onerror = reject; }
        });
        const canvas = document.createElement('canvas');
        canvas.width = imgEl.naturalWidth;
        canvas.height = imgEl.naturalHeight;
        canvas.getContext('2d').drawImage(imgEl, 0, 0);
        const blob = await new Promise((r) => canvas.toBlob(r, 'image/png'));
        if (!blob) throw new Error('blob 생성 실패');
        if (!navigator.clipboard || !window.ClipboardItem) {
          throw new Error('이 브라우저는 이미지 클립보드 복사를 지원하지 않습니다');
        }
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
        flashBtn(btn, '✓ 복사됨');
        showToast('이미지를 클립보드에 복사했습니다');
      } catch (e) {
        console.error(e);
        showToast('이미지 복사 실패 — 우클릭 → 이미지 복사 시도해주세요: ' + (e.message || ''), false);
      }
    }
    function downloadLightboxImage() {
      const img = IMAGES[lbIndex];
      const a = document.createElement('a');
      a.href = 'images/' + img;
      a.download = img;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      showToast('다운로드 시작: ' + img);
    }
    document.addEventListener('keydown', (e) => {
      const lb = document.getElementById('lightbox');
      if (!lb.classList.contains('show')) return;
      if (e.key === 'Escape') { e.preventDefault(); closeLightbox(); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); prevImage(); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); nextImage(); }
    });
    // 이미지 마커가 keyboard 로 활성화되도록
    document.addEventListener('keydown', (e) => {
      if ((e.key === 'Enter' || e.key === ' ') && document.activeElement.classList.contains('img-marker')) {
        e.preventDefault();
        const idx = parseInt(document.activeElement.dataset.imgIndex, 10);
        if (!isNaN(idx)) openLightbox(idx);
      }
      if ((e.key === 'Enter' || e.key === ' ') && document.activeElement.classList.contains('img-card')) {
        e.preventDefault();
        document.activeElement.click();
      }
    });

    async function downloadAll() {
      for (const img of IMAGES) {
        const a = document.createElement('a');
        a.href = 'images/' + img;
        a.download = img;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        await new Promise((r) => setTimeout(r, 250));
      }
      showToast('이미지 ' + IMAGES.length + '장 다운로드 시작');
    }
  </script>
</body>
</html>`;
}

function openInBrowser(filePath) {
  const p = platform();
  let cmd, args;
  if (p === 'win32') {
    cmd = 'cmd';
    args = ['/c', 'start', '""', filePath];
  } else if (p === 'darwin') {
    cmd = 'open';
    args = [filePath];
  } else {
    cmd = 'xdg-open';
    args = [filePath];
  }
  try {
    spawn(cmd, args, { detached: true, stdio: 'ignore' }).unref();
    return true;
  } catch {
    return false;
  }
}

async function main() {
  const args = parseArgs(process.argv);
  if (!args.folder) {
    console.error('Usage: --folder <output폴더경로> [--no-open]');
    process.exit(2);
  }

  const folder = args.folder.replace(/[\\/]+$/, '');
  const folderName = basename(folder);

  let postHtml, postMd, meta, images;
  try {
    postHtml = await readFile(join(folder, 'post.html'), 'utf8');
  } catch {
    console.error(`❌ ${folder}/post.html 을 찾을 수 없습니다.`);
    process.exit(1);
  }
  try {
    postMd = await readFile(join(folder, 'post.md'), 'utf8');
  } catch {
    postMd = null;
  }
  try {
    meta = JSON.parse(await readFile(join(folder, 'metadata.json'), 'utf8'));
  } catch {
    meta = { tags: [] };
    console.warn('⚠️  metadata.json 없음 — 빈 메타로 진행');
  }
  try {
    const all = await readdir(join(folder, 'images'));
    images = all.filter((f) => /\.(png|jpg|jpeg|webp)$/i.test(f));
    images = sortImagesNaturally(images);
  } catch {
    images = [];
    console.warn('⚠️  images/ 폴더 없음');
  }

  const { title, sections } = splitSections(postHtml);
  const usedTitle = meta.title || title;

  // 이미지 마커 인디케이터 변환:
  //  1) post.html 안에 [IMAGE: ...] 가 있으면 → 그대로 인디케이터로 변환
  //  2) post.html 에 없는데 post.md 에는 있으면 → md 의 마커를 단락 끝에 인공 삽입한 뒤 변환
  let markerCounter = 0;
  const sectionsWithPreview = [];
  let totalMarkersInHtml = 0;

  for (const s of sections) {
    const directCount = (s.html.match(MARKER_PATTERN) || []).length;
    totalMarkersInHtml += directCount;
  }

  let workingSections = sections.map((s) => ({ ...s }));

  if (totalMarkersInHtml === 0 && postMd) {
    const mdMarkers = extractMarkersFromMd(postMd);
    if (mdMarkers.length > 0) {
      console.log(`ℹ️  post.html 에 [IMAGE:] 마커 0개 / post.md 에 ${mdMarkers.length}개 — md 기준으로 인디케이터 위치 추정 중`);
      // md 마커를 모든 섹션 합친 흐름으로 분배
      let pool = [...mdMarkers];
      workingSections = sections.map((s, idx) => {
        const remaining = pool.length;
        if (remaining === 0) return { ...s };
        // 단순 분배: 섹션 N개에 균등 분배
        const perSection = Math.max(1, Math.ceil(pool.length / Math.max(1, sections.length - idx)));
        const slice = pool.slice(0, perSection);
        pool = pool.slice(perSection);
        const inj = injectMarkersFromMd(s.html, slice, images);
        return { ...s, html: inj.html };
      });
    }
  }

  for (const s of workingSections) {
    const out = transformImageMarkersInHtml(s.html, images, markerCounter);
    markerCounter += out.count;
    sectionsWithPreview.push({ ...s, preview: out.html });
  }

  const mdSections = postMd ? splitMdSections(postMd) : null;

  const previewHtml = renderPreviewHtml({
    folder: folderName,
    title: usedTitle,
    meta,
    sections: sectionsWithPreview,
    images,
    markerCount: markerCounter,
    mdSections,
  });

  const outPath = join(folder, 'preview.html');
  await writeFile(outPath, previewHtml);
  console.log(`\n✅ 미리보기 생성: ${outPath}`);
  console.log(`   섹션 ${sections.length}개 / 이미지 ${images.length}장 / 태그 ${(meta.tags || []).length}개 / [IMAGE:] 마커 ${markerCounter}개`);

  if (markerCounter === 0) {
    console.warn('⚠️  본문에서 [IMAGE: 설명] 마커를 찾지 못했습니다. blog-writer 가 마커를 본문에 표시했는지 확인하세요 (CLAUDE.md 권장: 최소 4개).');
  }

  if (!args['no-open']) {
    const ok = openInBrowser(outPath);
    if (ok) console.log(`\n🌐 브라우저로 열었습니다.`);
    else console.log(`\n수동으로 열어주세요: file://${outPath.replace(/\\/g, '/')}`);
  }

  console.log(`\n💡 사용법:`);
  console.log(`   1. 메타데이터 카드에서 제목·태그 복사 → 발행 플랫폼에 입력`);
  console.log(`   2. 본문 섹션마다 발행할 플랫폼에 맞는 복사 버튼을 누르세요:`);
  console.log(`        📋 네이버      — 스마트에디터 본문에 그대로 붙여넣기 (rich-text)`);
  console.log(`        📋 블로그스팟  — Blogger 의 〈/〉 HTML 보기에 붙여넣기 (raw HTML)`);
  console.log(`        📋 WordPress   — Gutenberg 블록 에디터에 붙여넣기 (마크다운)`);
  console.log(`        📝 텍스트     — 어디서든 fallback (서식 없음)`);
  console.log(`   3. 본문의 [IMAGE: ...] 인디케이터 박스 클릭 → 라이트박스에서 클립보드 복사`);
  console.log(`   4. 라이트박스에서 ← → 키로 이미지 넘기기, Esc 로 닫기`);
  console.log(`   5. 체크리스트 따라가며 발행`);
}

main().catch((e) => {
  console.error('Fatal:', e);
  process.exit(1);
});
