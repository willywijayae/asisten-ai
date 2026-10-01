// Ekstraktor kartu iklan dari halaman Meta Ad Library (facebook.com/ads/library), dijalankan
// di browser (Claude in Chrome / browser bawaan Claude) pada hasil pencarian yang diurutkan
// berdasarkan impresi. Hasilnya dikirim ke POST /api/competitors/ingest atau tool MCP
// save_competitor_ads. Tidak butuh login; hanya membaca apa yang tampil di layar.
//
// Pemakaian: jalankan seluruh isi file ini, lalu `await adLibraryExtract({ scrolls: 3 })`.
// Mengembalikan { query, country, url, ads: [...] } siap kirim.

async function adLibraryExtract({ scrolls = 3, max = 80 } = {}) {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  for (let i = 0; i < scrolls; i++) {
    window.scrollTo(0, document.body.scrollHeight);
    await sleep(2200);
  }

  const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, mei: 4, jun: 5, jul: 6, aug: 7, agu: 7, sep: 8, oct: 9, okt: 9, nov: 10, dec: 11, des: 11 };
  const parseDate = (s) => {
    const m = /(\d{1,2}) (\w{3})\w* (\d{4})/.exec(s || "");
    if (!m || MONTHS[m[2].toLowerCase()] == null) return null;
    return new Date(Date.UTC(+m[3], MONTHS[m[2].toLowerCase()], +m[1])).toISOString();
  };
  const unwrap = (href) => {
    try {
      const u = new URL(href);
      return u.hostname === "l.facebook.com" ? u.searchParams.get("u") : href;
    } catch {
      return null;
    }
  };

  const labels = [...document.querySelectorAll("span,div")].filter(
    (e) => e.childElementCount === 0 && /^Library ID: \d+/.test(e.textContent.trim()),
  );
  const ads = [];
  const seen = new Set();
  labels.forEach((label) => {
    const id = /\d+/.exec(label.textContent)[0];
    if (seen.has(id) || ads.length >= max) return;
    seen.add(id);
    // Naik ke elemen kartu: yang memuat label ini dan teks "Sponsored".
    let card = label;
    for (let i = 0; i < 14 && card.parentElement; i++) {
      card = card.parentElement;
      if (card.innerText.includes("Sponsored") && card.querySelectorAll("div").length > 20) break;
    }
    const text = card.innerText;
    const lines = text.split("\n").map((l) => l.trim()).filter((l) => l && l !== "​");
    const sponsoredAt = lines.indexOf("Sponsored");
    const pageName = sponsoredAt > 0 ? lines[sponsoredAt - 1] : null;

    // Teks iklan: dari setelah "Sponsored" sampai penanda video ("0:00 / 0:46") atau domain landing page.
    const endAt = lines.findIndex((l, i) => i > sponsoredAt && (/^\d+:\d{2} \/ \d+:\d{2}$/.test(l) || /^[A-Z0-9.-]+\.[A-Z]{2,}$/.test(l)));
    const body = sponsoredAt >= 0 ? lines.slice(sponsoredAt + 1, endAt > 0 ? endAt : undefined).filter((l) => l !== ".").join("\n") : null;

    const videos = [...card.querySelectorAll("video")].map((v) => ({ type: "video", url: v.currentSrc || v.src, poster: v.poster || null }));
    const images = [...card.querySelectorAll("img")]
      .filter((i) => i.naturalWidth >= 150 || i.width >= 150)
      .map((i) => ({ type: "image", url: i.src, w: i.naturalWidth, h: i.naturalHeight }));
    const avatar = [...card.querySelectorAll("img")].find((i) => i.naturalWidth > 0 && i.naturalWidth <= 80)?.src ?? null;

    const link = [...card.querySelectorAll('a[href*="l.facebook.com"]')].map((a) => unwrap(a.href)).find(Boolean) ?? null;
    const dup = /(\d+) ads? use this creative and text/i.exec(text);
    const duration = /\d+:\d{2} \/ (\d+:\d{2})/.exec(text);
    const ctaWords = ["Shop now", "Send message", "Send WhatsApp message", "Learn more", "Contact us", "Order now", "Sign up", "Book now", "Get offer", "Buy now", "Call now", "Message"];
    const cta = lines.find((l) => ctaWords.includes(l)) ?? null;
    // Judul & caption link: baris setelah domain (huruf kapital) di bagian bawah kartu.
    const domainIdx = lines.findIndex((l) => /^[A-Z0-9.-]+\.[A-Z]{2,}$/.test(l));

    ads.push({
      id,
      page_name: pageName,
      page_avatar: avatar,
      active: /\bActive\b/.test(lines.slice(0, 3).join(" ")),
      started_at: parseDate(lines.find((l) => l.startsWith("Started running on"))),
      body: body?.slice(0, 3000) ?? null,
      title: domainIdx >= 0 ? lines[domainIdx + 1] ?? null : null,
      caption: domainIdx >= 0 ? lines[domainIdx + 2] ?? null : null,
      link_url: link,
      cta,
      duplicates: dup ? +dup[1] : 1,
      multiple_versions: /multiple versions/i.test(text),
      video_duration: duration ? duration[1] : null,
      media: [...videos, ...images.filter((i) => !videos.some((v) => v.poster === i.url))],
      impression_rank: ads.length + 1,
      snapshot_url: `https://www.facebook.com/ads/library/?id=${id}`,
    });
  });

  const params = new URLSearchParams(location.search);
  return { query: params.get("q"), country: params.get("country") || "ID", url: location.href, ads };
}
