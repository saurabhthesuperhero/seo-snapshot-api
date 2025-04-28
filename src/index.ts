// src/index.ts
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import * as cheerio from 'cheerio';
import type { Element } from 'domhandler';

type Heading   = { tag: `h${1|2|3|4|5|6}`; text: string };
type LinkStats = {
  internalLinks: number;
  externalLinks: number;
  nofollowCount: number;
  brokenCount:  number;
};
type JsonLdLite = { type: string | null; name: string | null };
type HrefLang   = { hreflang: string; href: string };

/* ——— knobs ——— */
const MAX_LINK_HEAD_TEST = 10;

/* ——— “browser” headers ——— */
const DEFAULT_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
    '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9'
};

/* helpers */
const isShell = (html: string) =>
  html.length < 5_000 && /<script\b[^>]*src/i.test(html);
const toPrerender = (u: string) =>
  'https://r.jina.ai/http://' + u.replace(/^https?:\/\//, '');

const app = new Hono();
app.use('*', cors());

app.get('/snapshot', async (c) => {
  const url = c.req.query('url');
  if (!url) return c.json({ error: 'Missing ?url=' }, 400);

  try {
    /** 1. fetch (spoof UA) */
    let res  = await fetch(url, { redirect: 'follow', headers: DEFAULT_HEADERS });
    let html = await res.text();

    const blocked = /just a moment/i.test(html) || res.status >= 400;
    const prerenderForced = c.req.query('prerender') === '1';

    /** 2. prerender fallback */
    if (!blocked && (prerenderForced || isShell(html))) {
      res  = await fetch(toPrerender(url), { headers: DEFAULT_HEADERS });
      html = await res.text();
    }
    if (blocked) {
      return c.json({ error: 'Site is protected by a bot-check or returned an error' }, 423);
    }

    const sizeKb = Math.round(html.length / 10.24) / 100;
    const $ = cheerio.load(html);

    /* ───────── basic meta ───────── */
    const title           = $('title').first().text()                     || null;
    const metaDescription = $('meta[name="description"]').attr('content') || null;
    const canonical       = $('link[rel="canonical"]').attr('href')       || null;
    const lang            = $('html').attr('lang')                        || null;

    /* ───────── all meta / OG ───────── */
    const metaTags: Record<string,string> = {};
    $('meta').each((_, el: Element) => {
      const n = $(el).attr('name') ?? $(el).attr('property');
      const v = $(el).attr('content');
      if (n && v) metaTags[n.toLowerCase()] = v;
    });

    const ogTags: Record<string,string> = {};
    for (const [k,v] of Object.entries(metaTags))
      if (k.startsWith('og:')) ogTags[k] = v;

    /* ───────── headings ───────── */
    const headings: Heading[] = [];
    (['h1','h2','h3','h4','h5','h6'] as const).forEach(tag=>{
      $(tag).each((_, el: Element)=>{
        const text=$(el).text().trim();
        if (text) headings.push({ tag, text });
      });
    });
    const headingCounts = headings.reduce<Record<string,number>>(
      (a,h)=>(a[h.tag]=(a[h.tag]||0)+1,a),{});

    /* ───────── links ───────── */
    const pageHost = new URL(url).hostname.replace(/^www\./i,'');
    let internal=0, external=0, nofollow=0; const uniqueExternal=new Set<string>();

    $('a[href]').each((_,el)=>{
      const href = ($(el).attr('href')||'').trim();
      if (!href || href.startsWith('javascript:') || href.startsWith('mailto:')) return;
      const rel = ($(el).attr('rel')||'').toLowerCase();
      if (rel.includes('nofollow')) nofollow++;

      let host:string|null=null;
      try{host=new URL(href, url).hostname.replace(/^www\./i,'');}catch{}
      if (!host || host===pageHost || href.startsWith('#') || href.startsWith('/')){
        internal++;
      } else {
        external++;
        uniqueExternal.add(new URL(href, url).toString());
      }
    });

    /* broken-link probe */
    const probeTargets=[...uniqueExternal].slice(0,MAX_LINK_HEAD_TEST);
    let brokenCount=0;
    if (probeTargets.length){
      const results=await Promise.allSettled(
        probeTargets.map(h=>fetch(h,{method:'HEAD',redirect:'follow',headers:DEFAULT_HEADERS}))
      );
      results.forEach(r=>{
        if (r.status==='rejected') brokenCount++;
        else if (r.value.status>=400) brokenCount++;
      });
    }

    const linkStats: LinkStats = {
      internalLinks: internal,
      externalLinks: external,
      nofollowCount: nofollow,
      brokenCount
    };

    /* ───────── JSON-LD ───────── */
    const jsonLd: JsonLdLite[] = [];
    $('script[type="application/ld+json"]').each((_,el)=>{
      try{
        const raw=$(el).text().trim();
        const data=JSON.parse(raw);
        const arr=Array.isArray(data)?data:[data];
        arr.forEach(o=>jsonLd.push({
          type:o['@type']||o.type||null,
          name:o.name||o.headline||null
        }));
      }catch{}
    });

    /* ───────── hreflang ───────── */
    const hreflangs: HrefLang[] = [];
    $('link[rel="alternate"][hreflang]').each((_,el)=>{
      const l=$(el).attr('hreflang'); const h=$(el).attr('href');
      if (l && h) hreflangs.push({ hreflang: l, href: h });
    });

    /* ───────── counts & word/img ───────── */
    const textBody=$('body').text().replace(/\s+/g,' ').trim();
    const wordCount=textBody.split(/\s+/).filter(Boolean).length;
    const imageCount=$('img').length;

    /* image alt audit */
    let imagesWithAlt=0, imagesMissingAlt=0;
    $('img').each((_,el)=>{
      ($(el).attr('alt')||'').trim() ? imagesWithAlt++ : imagesMissingAlt++;
    });

    /* robots directives */
    const robotsMeta=(metaTags['robots']||'').toLowerCase();
    const xRobots=(res.headers.get('x-robots-tag')||'').toLowerCase();
    const robotsDirectives=[...robotsMeta.split(','), ...xRobots.split(',')]
      .map(s=>s.trim()).filter(Boolean);

    /* canonical status */
    let canonicalStatus:'self'|'different'|'missing'='missing';
    if (canonical){
      const norm=(s:string)=>s.replace(/\/$/,'');
      canonicalStatus = norm(canonical)===norm(url)?'self':'different';
    }

    /* ───────── SEO node ───────── */
    const seo = {
      titleLength: title?.length || 0,
      titleTooLong: (title?.length || 0) > 60,
      metaDescriptionLength: metaDescription?.length || 0,
      metaDescriptionTooLong: (metaDescription?.length || 0) > 160,
      h1Count: headingCounts.h1 || 0,
      imagesWithAlt,
      imagesMissingAlt,
      robotsDirectives,
      canonicalStatus,
      hasOgTags: Object.keys(ogTags).length > 0,
      hasJsonLd: jsonLd.length > 0,
      wordCount,
      ...linkStats
    };

    /* ───────── response ───────── */
    return c.json({
      url, title, metaDescription, canonical, lang,
      pageSizeKb: sizeKb,
      wordCount, imageCount,             // keep old top-level counts
      metaTags, ogTags,
      headings, headingCounts,
      linkStats,
      jsonLd,
      hreflangs,
      seo,                               // ← new enriched node
      prerendered: prerenderForced || isShell(html)
    });
  } catch (err:any) {
    return c.json({ error:'Failed to fetch or parse page', detail: err?.message }, 500);
  }
});

export default app;
