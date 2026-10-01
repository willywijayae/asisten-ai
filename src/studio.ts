import type { Env } from "./env";
import * as db from "./db";
import * as profile from "./profile";
import * as memory from "./memory";
import { clip, logActivity, type AgentId } from "./activity";
import { complete } from "./agent";
import { parseLooseJson } from "./competitors";
import { modelLabel } from "./marketing";
import { Telegram } from "./telegram";

// Studio Konten: avatar → produk → storyboard → hasil video.
// Pola Archify: setiap tahap menghasilkan data terstruktur (JSON) yang divalidasi, bisa diedit
// pemilik, dan harus disetujui sebelum tahap berikutnya dibuat. Penulisan memakai Opus.
// Hasil video: prompt siap tempel untuk ChatGPT (Sora) / Grok Imagine, atau dibuat otomatis
// lewat API kalau OPENAI_API_KEY / XAI_API_KEY diisi.

export type Stage = "avatar" | "produk" | "storyboard";
export type Provider = "chatgpt" | "grok";
export const STAGES: Stage[] = ["avatar", "produk", "storyboard"];

export interface AvatarData {
  customer: {
    name: string;
    age: string;
    situation: string;
    pains: string[];
    desires: string[];
    objections: string[];
    language: string[];
    channels: string[];
  };
  character: {
    name: string;
    role: string;
    age: string;
    look: string;
    voice: string;
    /** Deskripsi bahasa Inggris yang dipakai sama persis di setiap prompt video supaya wajahnya konsisten. */
    consistency: string;
  };
}

export interface ProductData {
  input: { name: string; price?: string; benefits?: string; proof?: string; offer?: string; cta?: string; link?: string };
  product: { name: string; price: string; benefits: string[]; proof: string[]; offer: string; cta: string; look: string };
  angle: string;
  big_idea: string;
  hooks: string[];
  chosen_hook: number;
  objections: { objection: string; answer: string }[];
  compliance: string[];
}

export interface Scene {
  no: number;
  seconds: number;
  shot: string;
  visual: string;
  action: string;
  dialogue: string;
  on_screen_text: string;
  audio: string;
}

export interface StoryboardData {
  title: string;
  duration: number;
  provider: Provider;
  aspect: "9:16";
  scenes: Scene[];
  caption: string;
  hashtags: string[];
  cta: string;
}

export interface Project {
  id: number;
  title: string;
  brief: string | null;
  stage: Stage | "hasil";
  avatar: string | null;
  product: string | null;
  storyboard: string | null;
  approved: string | null;
  provider: Provider | null;
  source_ad_id: string | null;
  busy: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
}

export interface Clip {
  id: number;
  project_id: number;
  scene_no: number;
  provider: Provider;
  seconds: number;
  prompt: string;
  status: "prompt" | "rendering" | "done" | "failed" | "uploaded";
  job_id: string | null;
  media_key: string | null;
  error: string | null;
  updated_at: string;
}

/** Batas panjang satu klip per penyedia (detik). Sora: 4/8/12; Grok Imagine: sampai 15. */
export const CLIP_LIMIT: Record<Provider, number> = { chatgpt: 12, grok: 15 };
const SORA_SECONDS = [4, 8, 12];

const STAGE_ACTOR: Record<Stage, AgentId> = { avatar: "riset", produk: "copywriter", storyboard: "konten" };
const STAGE_NAME: Record<Stage, string> = { avatar: "Avatar", produk: "Produk", storyboard: "Storyboard" };

const now = () => new Date().toISOString();
const str = (v: unknown, n = 2000) => String(v ?? "").trim().slice(0, n);
const strs = (v: unknown, max = 10, n = 400) =>
  Array.isArray(v) ? v.map((x) => str(x, n)).filter(Boolean).slice(0, max) : [];

// --- Validasi (ala Archify: kesalahan disebut persis supaya bisa diperbaiki) ---

export function validateAvatar(d: any): { data: AvatarData; errors: string[] } {
  const c = d?.customer ?? {};
  const ch = d?.character ?? {};
  const data: AvatarData = {
    customer: {
      name: str(c.name, 80),
      age: str(c.age, 40),
      situation: str(c.situation, 600),
      pains: strs(c.pains),
      desires: strs(c.desires),
      objections: strs(c.objections),
      language: strs(c.language, 10, 120),
      channels: strs(c.channels, 6, 60),
    },
    character: {
      name: str(ch.name, 60),
      role: str(ch.role, 120),
      age: str(ch.age, 40),
      look: str(ch.look, 600),
      voice: str(ch.voice, 300),
      consistency: str(ch.consistency, 900),
    },
  };
  const errors: string[] = [];
  if (!data.customer.name) errors.push("Avatar pelanggan belum punya nama.");
  if (data.customer.pains.length < 2) errors.push("Isi minimal 2 keluhan (pains) pelanggan.");
  if (!data.customer.desires.length) errors.push("Isi minimal 1 keinginan pelanggan.");
  if (!data.character.name) errors.push("Karakter video belum punya nama.");
  if (data.character.look.length < 15) errors.push("Tampilan karakter terlalu singkat — jelaskan wajah, usia, pakaian, latar.");
  if (data.character.consistency.length < 40) errors.push("Deskripsi konsistensi karakter (bahasa Inggris) minimal 40 huruf.");
  return { data, errors };
}

export function validateProduct(d: any): { data: ProductData; errors: string[] } {
  const p = d?.product ?? {};
  const hooks = strs(d?.hooks, 8, 300);
  const data: ProductData = {
    input: d?.input ?? { name: str(p.name, 120) },
    product: {
      name: str(p.name, 120),
      price: str(p.price, 120),
      benefits: strs(p.benefits, 8, 200),
      proof: strs(p.proof, 6, 200),
      offer: str(p.offer, 300),
      cta: str(p.cta, 200),
      look: str(p.look, 400),
    },
    angle: str(d?.angle, 400),
    big_idea: str(d?.big_idea, 600),
    hooks,
    chosen_hook: Math.max(0, Math.min(hooks.length - 1, Math.round(Number(d?.chosen_hook) || 0))),
    objections: Array.isArray(d?.objections)
      ? d.objections.slice(0, 6).map((o: any) => ({ objection: str(o?.objection, 200), answer: str(o?.answer, 400) })).filter((o: any) => o.objection)
      : [],
    compliance: strs(d?.compliance, 8, 300),
  };
  const errors: string[] = [];
  if (!data.product.name) errors.push("Nama produk wajib diisi.");
  if (!data.product.benefits.length) errors.push("Isi minimal 1 manfaat produk.");
  if (hooks.length < 3) errors.push("Butuh minimal 3 pilihan hook.");
  if (!data.product.cta) errors.push("CTA (ajakan bertindak) wajib diisi.");
  return { data, errors };
}

export function validateStoryboard(d: any, provider: Provider, target: number): { data: StoryboardData; errors: string[] } {
  const limit = CLIP_LIMIT[provider];
  const scenes: Scene[] = (Array.isArray(d?.scenes) ? d.scenes : []).slice(0, 14).map((s: any, i: number) => ({
    no: i + 1,
    seconds: Math.max(2, Math.round(Number(s?.seconds) || 4)),
    shot: str(s?.shot, 160),
    visual: str(s?.visual, 700),
    action: str(s?.action, 400),
    dialogue: str(s?.dialogue, 400),
    on_screen_text: str(s?.on_screen_text, 140),
    audio: str(s?.audio, 200),
  }));
  const total = scenes.reduce((n, s) => n + s.seconds, 0);
  const data: StoryboardData = {
    title: str(d?.title, 120),
    duration: total,
    provider,
    aspect: "9:16",
    scenes,
    caption: str(d?.caption, 2500),
    hashtags: strs(d?.hashtags, 12, 40),
    cta: str(d?.cta, 200),
  };
  const errors: string[] = [];
  if (scenes.length < 2) errors.push("Storyboard butuh minimal 2 adegan.");
  scenes.forEach((s) => {
    if (!s.visual) errors.push(`Adegan ${s.no}: visual kosong.`);
    if (!s.dialogue && !s.on_screen_text) errors.push(`Adegan ${s.no}: isi dialog atau teks layar.`);
    if (s.seconds > limit) errors.push(`Adegan ${s.no}: ${s.seconds} detik melebihi batas satu klip ${provider === "grok" ? "Grok" : "Sora"} (${limit} detik) — pecah jadi 2 adegan.`);
  });
  if (target && Math.abs(total - target) > Math.max(5, target * 0.25))
    errors.push(`Total durasi ${total} detik jauh dari target ${target} detik.`);
  if (!data.caption) errors.push("Caption iklan belum ada.");
  return { data, errors };
}

// --- Proyek ---

export async function listProjects(env: Env) {
  const { results } = await env.DB.prepare(
    `SELECT p.id, p.title, p.stage, p.busy, p.provider, p.updated_at, p.created_at,
       (SELECT count(*) FROM content_clips c WHERE c.project_id = p.id AND c.status IN ('done','uploaded')) AS clips_ready
     FROM content_projects p ORDER BY p.updated_at DESC LIMIT 100`,
  ).all();
  return results;
}

export async function getProject(env: Env, id: number) {
  const p = await env.DB.prepare("SELECT * FROM content_projects WHERE id = ?").bind(id).first<Project>();
  if (!p) return null;
  const { results: clips } = await env.DB.prepare("SELECT * FROM content_clips WHERE project_id = ? ORDER BY provider, scene_no")
    .bind(id)
    .all<Clip>();
  const character = await env.MEDIA.getWithMetadata(`studio:${id}:character`, "stream");
  if (character.value) await character.value.cancel();
  return {
    ...p,
    avatar: p.avatar ? (JSON.parse(p.avatar) as AvatarData) : null,
    product: p.product ? (JSON.parse(p.product) as ProductData) : null,
    storyboard: p.storyboard ? (JSON.parse(p.storyboard) as StoryboardData) : null,
    approved: p.approved ? (JSON.parse(p.approved) as Partial<Record<Stage, string>>) : {},
    clips,
    has_character_image: !!character.value,
    api: { chatgpt: !!env.OPENAI_API_KEY, grok: !!env.XAI_API_KEY },
  };
}

export async function createProject(env: Env, input: { title?: string; brief: string; source_ad_id?: string }): Promise<number> {
  const brief = str(input.brief, 2000);
  if (brief.length < 5) throw new Error("Tulis brief singkat dulu: produk apa, untuk siapa, tujuannya apa.");
  const row = await env.DB.prepare("INSERT INTO content_projects (title, brief, source_ad_id) VALUES (?, ?, ?) RETURNING id")
    .bind(str(input.title, 120) || clip(brief, 60), brief, input.source_ad_id ?? null)
    .first<{ id: number }>();
  await requestStage(env, row!.id, "avatar");
  return row!.id;
}

export async function deleteProject(env: Env, id: number): Promise<void> {
  const { results } = await env.DB.prepare("SELECT media_key FROM content_clips WHERE project_id = ? AND media_key IS NOT NULL")
    .bind(id)
    .all<{ media_key: string }>();
  await Promise.all([...results.map((r) => env.MEDIA.delete(r.media_key)), env.MEDIA.delete(`studio:${id}:character`)]);
  await env.DB.batch([
    env.DB.prepare("DELETE FROM content_clips WHERE project_id = ?").bind(id),
    env.DB.prepare("DELETE FROM content_projects WHERE id = ?").bind(id),
  ]);
}

/** Minta AI membuat (ulang) satu tahap. Dikerjakan consumer antrean; UI memantau kolom `busy`. */
export async function requestStage(env: Env, id: number, stage: Stage, options: Record<string, unknown> = {}): Promise<void> {
  const p = await env.DB.prepare("SELECT * FROM content_projects WHERE id = ?").bind(id).first<Project>();
  if (!p) throw new Error("Proyek tidak ditemukan");
  const approved = JSON.parse(p.approved ?? "{}") as Partial<Record<Stage, string>>;
  if (stage === "produk" && !approved.avatar) throw new Error("Setujui avatar dulu.");
  if (stage === "storyboard" && !approved.produk) throw new Error("Setujui produk dulu.");
  await env.DB.prepare("UPDATE content_projects SET busy = ?, error = NULL, updated_at = ? WHERE id = ?").bind(stage, now(), id).run();
  await logActivity(
    env,
    "manajer_marketing",
    "step",
    `Studio "${clip(p.title, 40)}": menugaskan tahap ${STAGE_NAME[stage]}`,
    `visit:${STAGE_ACTOR[stage]}`,
  );
  await env.JOBS.send({ type: "studio", projectId: id, stage, options });
}

/** Simpan hasil edit pemilik (dan setujui kalau diminta). Mengembalikan daftar kesalahan validasi. */
export async function saveStage(env: Env, id: number, stage: Stage, data: unknown, approve: boolean): Promise<string[]> {
  const p = await env.DB.prepare("SELECT * FROM content_projects WHERE id = ?").bind(id).first<Project>();
  if (!p) throw new Error("Proyek tidak ditemukan");
  const provider = (p.provider ?? "chatgpt") as Provider;
  const target = p.storyboard ? (JSON.parse(p.storyboard) as StoryboardData).duration : 0;
  const result =
    stage === "avatar" ? validateAvatar(data) : stage === "produk" ? validateProduct(data) : validateStoryboard(data, provider, target);
  if (approve && result.errors.length) return result.errors;
  const column = stage === "avatar" ? "avatar" : stage === "produk" ? "product" : "storyboard";
  const approved = JSON.parse(p.approved ?? "{}") as Partial<Record<Stage, string>>;
  // Mengubah tahap yang sudah disetujui membatalkan persetujuan tahap sesudahnya.
  const after = STAGES.slice(STAGES.indexOf(stage) + (approve ? 1 : 0));
  for (const s of after) delete approved[s];
  if (approve) approved[stage] = now();
  const nextStage = approve ? (STAGES[STAGES.indexOf(stage) + 1] ?? "hasil") : stage;
  await env.DB.prepare(`UPDATE content_projects SET ${column} = ?, approved = ?, stage = ?, updated_at = ? WHERE id = ?`)
    .bind(JSON.stringify(result.data), JSON.stringify(approved), nextStage, now(), id)
    .run();
  if (approve && stage === "storyboard") await buildClips(env, id, provider);
  return approve ? [] : result.errors;
}

// --- Pekerjaan AI per tahap (consumer antrean) ---

const RULES = `
Aturan wajib: bahasa Indonesia natural; aman kebijakan iklan Meta & BPOM (tanpa klaim menyembuhkan/menjamin hasil, tanpa klaim pelangsingan, tanpa konten seksual eksplisit, tanpa before-after); pakai "membantu menjaga…" dan testimoni. Balas HANYA JSON valid sesuai bentuk yang diminta.`;

function avatarPrompt() {
  return `Kamu Periset di tim marketing pemilik. Tentukan AVATAR untuk satu konten video iklan:
1) Avatar PELANGGAN: satu orang spesifik yang mewakili target pasar (nama panggilan, usia, situasi hidup, keluhan, keinginan, keberatan sebelum membeli, kata-kata yang mereka pakai sehari-hari, tempat mereka nongkrong online).
2) KARAKTER VIDEO AI: talent yang tampil di video dan dipercaya avatar pelanggan (biasanya mirip pelanggan atau sedikit lebih tua/berpengalaman). "consistency" = deskripsi fisik BAHASA INGGRIS yang sangat spesifik (usia, etnis Indonesia, bentuk wajah, rambut/hijab & warnanya, pakaian, aksesori, latar rumah) untuk dipakai identik di setiap prompt video.
Bentuk JSON:
{"customer":{"name":"","age":"","situation":"","pains":[""],"desires":[""],"objections":[""],"language":[""],"channels":[""]},
 "character":{"name":"","role":"","age":"","look":"deskripsi Indonesia","voice":"gaya bicara","consistency":"English description"}}${RULES}`;
}

function productPrompt() {
  return `Kamu Copywriter di tim marketing pemilik. Dari avatar dan data produk, tentukan cara menjual produk ini ke avatar tersebut.
Bentuk JSON:
{"product":{"name":"","price":"","benefits":[""],"proof":["BPOM/Halal/testimoni bila ada"],"offer":"","cta":"","look":"tampilan kemasan dalam bahasa Inggris untuk prompt video"},
 "angle":"sudut jualan utama","big_idea":"satu ide besar konten",
 "hooks":["5 hook pembuka 3 detik, berbeda gaya: usia/identitas, durasi masalah, reframe, pertanyaan, testimoni"],
 "chosen_hook":0,
 "objections":[{"objection":"keberatan avatar","answer":"jawaban singkat"}],
 "compliance":["klaim yang harus dihindari untuk produk ini"]}${RULES}`;
}

function storyboardPrompt(duration: number, provider: Provider) {
  return `Kamu Perencana Konten (video) di tim marketing pemilik. Buat STORYBOARD video iklan vertikal 9:16 berdurasi ±${duration} detik untuk dibuat dengan ${provider === "grok" ? "Grok Imagine" : "Sora (ChatGPT)"}.
- Satu adegan = satu klip video, maksimal ${CLIP_LIMIT[provider]} detik per adegan${provider === "chatgpt" ? " (pakai 4, 8, atau 12 detik)" : ""}.
- Adegan 1 = hook terpilih (≤4 detik), adegan terakhir = CTA. Karakter video yang sama di semua adegan.
- "dialogue" = ucapan karakter dalam bahasa Indonesia santai (cukup pendek untuk durasi adegannya, ±2,5 kata per detik). "visual" & "action" & "shot" ditulis dalam BAHASA INGGRIS (untuk generator video). "on_screen_text" bahasa Indonesia, pendek.
Bentuk JSON:
{"title":"","scenes":[{"seconds":4,"shot":"close-up, handheld","visual":"","action":"","dialogue":"","on_screen_text":"","audio":"musik/sfx"}],
 "caption":"caption iklan lengkap: hook → agitasi → solusi → manfaat → bukti → CTA","hashtags":[""],"cta":""}${RULES}`;
}

/** Dipanggil consumer antrean. */
export async function runStage(env: Env, id: number, stage: Stage, options: Record<string, any> = {}): Promise<void> {
  const p = await env.DB.prepare("SELECT * FROM content_projects WHERE id = ?").bind(id).first<Project>();
  if (!p) return;
  const actor = STAGE_ACTOR[stage];
  const fail = async (message: string) => {
    await env.DB.prepare("UPDATE content_projects SET busy = NULL, error = ?, updated_at = ? WHERE id = ?").bind(message.slice(0, 500), now(), id).run();
    await logActivity(env, actor, "error", `Studio ${STAGE_NAME[stage]} gagal: ${message}`);
  };
  try {
    await logActivity(env, actor, "start", `Studio "${clip(p.title, 40)}": menyusun ${STAGE_NAME[stage]}`, "mboard");
    const [owner, context] = await Promise.all([profile.ownerContext(env), memory.autoContext(env, p.brief ?? p.title)]);
    let reference = "";
    if (p.source_ad_id) {
      const ad = await env.DB.prepare("SELECT page_name, body, title, media_type, video_duration FROM competitor_ads WHERE id = ?")
        .bind(p.source_ad_id)
        .first<{ page_name: string; body: string | null; title: string | null; media_type: string | null; video_duration: string | null }>();
      if (ad) reference = `\n\nIKLAN KOMPETITOR ACUAN (${ad.page_name}, ${ad.media_type ?? ""} ${ad.video_duration ?? ""}):\n${clip([ad.title, ad.body].filter(Boolean).join("\n"), 1500)}`;
    }
    const avatar = p.avatar ? JSON.parse(p.avatar) : null;
    const product = p.product ? JSON.parse(p.product) : null;

    let system: string;
    let user: string;
    const provider: Provider = options.provider === "grok" ? "grok" : options.provider === "chatgpt" ? "chatgpt" : ((p.provider as Provider) ?? "chatgpt");
    const duration = Math.max(8, Math.min(90, Number(options.duration) || 30));
    if (stage === "avatar") {
      system = avatarPrompt() + owner;
      user = `BRIEF PEMILIK:\n${p.brief}${options.note ? `\n\nCATATAN REVISI: ${options.note}` : ""}${reference}${context ? `\n\n${context}` : ""}`;
    } else if (stage === "produk") {
      system = productPrompt() + owner;
      const input = options.input ?? product?.input ?? {};
      user = `BRIEF: ${p.brief}\n\nAVATAR:\n${JSON.stringify(avatar)}\n\nDATA PRODUK DARI PEMILIK:\n${JSON.stringify(input)}${options.note ? `\n\nCATATAN REVISI: ${options.note}` : ""}${reference}${context ? `\n\n${context}` : ""}`;
    } else {
      system = storyboardPrompt(duration, provider) + owner;
      const hook = product?.hooks?.[product?.chosen_hook ?? 0];
      user = `BRIEF: ${p.brief}\n\nAVATAR:\n${JSON.stringify(avatar)}\n\nPRODUK & ANGLE:\n${JSON.stringify(product)}\n\nHOOK TERPILIH: ${hook}${options.note ? `\n\nCATATAN REVISI: ${options.note}` : ""}${reference}`;
    }

    let parsed: any = null;
    let model = "";
    let errors: string[] = [];
    for (let attempt = 0; attempt < 2; attempt++) {
      const res = await complete(env, {
        system,
        user: attempt && errors.length ? `${user}\n\nPERBAIKI kesalahan ini dari jawaban sebelumnya:\n- ${errors.join("\n- ")}` : user,
        tier: "smart",
        actor,
        maxTokens: 6000,
        noThinking: true,
      });
      model = res.model;
      parsed = parseLooseJson(res.text);
      if (!parsed) {
        errors = ["Jawaban bukan JSON yang valid."];
        continue;
      }
      if (stage === "produk") parsed.input = options.input ?? product?.input ?? {};
      const v = stage === "avatar" ? validateAvatar(parsed) : stage === "produk" ? validateProduct(parsed) : validateStoryboard(parsed, provider, duration);
      parsed = v.data;
      errors = v.errors;
      if (!errors.length) break;
    }
    if (!parsed) return fail("Hasil AI tidak terbaca, coba lagi");

    const column = stage === "avatar" ? "avatar" : stage === "produk" ? "product" : "storyboard";
    await env.DB.prepare(
      `UPDATE content_projects SET ${column} = ?, busy = NULL, error = ?, stage = ?, provider = coalesce(?, provider), updated_at = ? WHERE id = ?`,
    )
      .bind(
        JSON.stringify(parsed),
        errors.length ? `Perlu dicek: ${errors.join(" ")}` : null,
        stage,
        stage === "storyboard" ? provider : null,
        now(),
        id,
      )
      .run();
    await logActivity(env, actor, "done", `Studio "${clip(p.title, 40)}": ${STAGE_NAME[stage]} siap (${modelLabel(env, model)})`);
  } catch (err) {
    await fail(String(err));
  }
}

// --- Hasil: prompt per klip untuk ChatGPT (Sora) / Grok Imagine ---

function soraSeconds(n: number): number {
  return SORA_SECONDS.find((s) => s >= n) ?? 12;
}

export function clipPrompt(avatar: AvatarData, product: ProductData, sb: StoryboardData, scene: Scene, provider: Provider): { prompt: string; seconds: number } {
  const seconds = provider === "chatgpt" ? soraSeconds(scene.seconds) : Math.min(CLIP_LIMIT.grok, Math.max(3, scene.seconds));
  const lines = [
    `Vertical 9:16 smartphone UGC-style ad video, ${seconds} seconds, photorealistic, natural light, Indonesian setting.`,
    `Main character (keep identical across all clips): ${avatar.character.consistency}`,
    `Scene ${scene.no} of ${sb.scenes.length}: ${scene.visual}`,
    scene.action && `Action: ${scene.action}`,
    scene.shot && `Camera: ${scene.shot}`,
    scene.dialogue && `The character speaks in casual Indonesian (Bahasa Indonesia), lip-synced, warm tone: "${scene.dialogue}"`,
    scene.on_screen_text && `On-screen text overlay in Indonesian: "${scene.on_screen_text}"`,
    product.product.look && `Product (when shown): ${product.product.name} — ${product.product.look}`,
    scene.audio && `Audio: ${scene.audio}`,
    `No other subtitles, no watermarks, no other brand logos.`,
  ];
  return { prompt: lines.filter(Boolean).join("\n"), seconds };
}

export async function buildClips(env: Env, id: number, provider: Provider): Promise<void> {
  const p = await getProject(env, id);
  if (!p?.avatar || !p.product || !p.storyboard) throw new Error("Storyboard belum lengkap");
  const stmts = p.storyboard.scenes.map((s) => {
    const { prompt, seconds } = clipPrompt(p.avatar!, p.product!, p.storyboard!, s, provider);
    return env.DB.prepare(
      `INSERT INTO content_clips (project_id, scene_no, provider, seconds, prompt) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (project_id, scene_no, provider) DO UPDATE SET
         prompt = excluded.prompt, seconds = excluded.seconds, updated_at = excluded.updated_at`,
    ).bind(id, s.no, provider, seconds, prompt);
  });
  // Adegan yang sudah dihapus dari storyboard tidak perlu klip lagi.
  stmts.push(
    env.DB.prepare("DELETE FROM content_clips WHERE project_id = ? AND provider = ? AND scene_no > ? AND media_key IS NULL").bind(
      id,
      provider,
      p.storyboard.scenes.length,
    ),
  );
  await env.DB.batch(stmts);
  await env.DB.prepare("UPDATE content_projects SET provider = ?, stage = 'hasil', updated_at = ? WHERE id = ?").bind(provider, now(), id).run();
}

const clipKey = (clipId: number) => `studio:clip:${clipId}`;

export async function uploadClip(env: Env, clipId: number, body: ArrayBuffer, type: string): Promise<void> {
  if (body.byteLength > 24 * 1024 * 1024) throw new Error("Video maksimal 24 MB. Kompres dulu atau potong.");
  if (!/^video\//.test(type)) throw new Error("File harus video (mp4/mov/webm).");
  await env.MEDIA.put(clipKey(clipId), body, { metadata: { type } });
  await env.DB.prepare("UPDATE content_clips SET status = 'uploaded', media_key = ?, error = NULL, updated_at = ? WHERE id = ?")
    .bind(clipKey(clipId), now(), clipId)
    .run();
}

export async function uploadCharacter(env: Env, id: number, body: ArrayBuffer, type: string): Promise<void> {
  if (body.byteLength > 5 * 1024 * 1024) throw new Error("Foto maksimal 5 MB.");
  if (!/^image\/(png|jpeg|webp)$/.test(type)) throw new Error("Foto harus PNG, JPG, atau WebP.");
  await env.MEDIA.put(`studio:${id}:character`, body, { metadata: { type } });
}

export async function serveStudioMedia(env: Env, key: string, req: Request): Promise<Response> {
  const stored = await env.MEDIA.getWithMetadata<{ type: string }>(key, "arrayBuffer");
  if (!stored.value) return new Response("Tidak ditemukan", { status: 404 });
  const buf = stored.value;
  const headers: Record<string, string> = {
    "content-type": stored.metadata?.type ?? "application/octet-stream",
    "cache-control": "private, max-age=86400",
    "accept-ranges": "bytes",
  };
  const range = /bytes=(\d*)-(\d*)/.exec(req.headers.get("range") ?? "");
  if (range) {
    const start = range[1] ? Number(range[1]) : 0;
    const end = range[2] ? Math.min(Number(range[2]), buf.byteLength - 1) : buf.byteLength - 1;
    return new Response(buf.slice(start, end + 1), {
      status: 206,
      headers: { ...headers, "content-range": `bytes ${start}-${end}/${buf.byteLength}`, "content-length": String(end - start + 1) },
    });
  }
  return new Response(buf, { headers });
}

// --- Mode API: buat video otomatis lewat OpenAI (Sora) / xAI (Grok Imagine) ---

const signingKey = (env: Env) => env.ENCRYPTION_KEY || env.INGEST_KEY || env.TELEGRAM_WEBHOOK_SECRET;

async function hmac(env: Env, data: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(signingKey(env)), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** URL publik bertanda tangan (berlaku 1 jam) supaya Grok bisa mengambil foto karakter. */
export async function signedMediaUrl(env: Env, key: string): Promise<string> {
  const exp = Math.floor(Date.now() / 1000) + 3600;
  return `${env.PUBLIC_URL}/api/public-media?key=${encodeURIComponent(key)}&exp=${exp}&sig=${await hmac(env, `${key}:${exp}`)}`;
}

export async function verifySignedMedia(env: Env, url: URL): Promise<string | null> {
  const key = url.searchParams.get("key") ?? "";
  const exp = Number(url.searchParams.get("exp"));
  const sig = url.searchParams.get("sig") ?? "";
  if (!key.startsWith("studio:") || !exp || exp < Date.now() / 1000) return null;
  return sig === (await hmac(env, `${key}:${exp}`)) ? key : null;
}

export async function requestRender(env: Env, clipId: number): Promise<void> {
  const c = await env.DB.prepare("SELECT * FROM content_clips WHERE id = ?").bind(clipId).first<Clip>();
  if (!c) throw new Error("Klip tidak ditemukan");
  if (c.provider === "chatgpt" && !env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY belum diisi — pakai mode prompt dulu.");
  if (c.provider === "grok" && !env.XAI_API_KEY) throw new Error("XAI_API_KEY belum diisi — pakai mode prompt dulu.");
  if (c.provider === "grok" && !(await env.MEDIA.get(`studio:${c.project_id}:character`, "stream").then((s) => (s?.cancel(), !!s))))
    throw new Error("Grok Imagine butuh foto karakter (image-to-video). Unggah foto karakter dulu.");
  await env.DB.prepare("UPDATE content_clips SET status = 'rendering', job_id = NULL, error = NULL, updated_at = ? WHERE id = ?").bind(now(), clipId).run();
  await logActivity(env, "konten", "start", `Membuat video adegan ${c.scene_no} lewat ${c.provider === "grok" ? "Grok" : "Sora"}`, "mboard");
  await env.JOBS.send({ type: "video", clipId });
}

/** Consumer antrean: buat pekerjaan, lalu cek berkala (antre ulang tiap 30 detik) sampai videonya jadi. */
export async function runVideo(env: Env, clipId: number): Promise<void> {
  const c = await env.DB.prepare("SELECT * FROM content_clips WHERE id = ?").bind(clipId).first<Clip>();
  if (!c || c.status !== "rendering") return;
  const fail = async (message: string) => {
    await env.DB.prepare("UPDATE content_clips SET status = 'failed', error = ?, updated_at = ? WHERE id = ?").bind(message.slice(0, 500), now(), clipId).run();
    await logActivity(env, "konten", "error", `Video adegan ${c.scene_no} gagal: ${message}`);
  };
  const again = async () => {
    await env.JOBS.send({ type: "video", clipId }, { delaySeconds: 30 });
  };
  try {
    if (Date.now() - Date.parse(c.updated_at) > 40 * 60_000 && c.job_id) return fail("Terlalu lama (lebih dari 40 menit)");
    if (c.provider === "chatgpt") {
      const auth = { Authorization: `Bearer ${env.OPENAI_API_KEY}` };
      if (!c.job_id) {
        const form = new FormData();
        form.set("model", env.SORA_MODEL || "sora-2");
        form.set("prompt", c.prompt);
        form.set("seconds", String(c.seconds));
        form.set("size", env.SORA_SIZE || "720x1280");
        const ref = await env.MEDIA.getWithMetadata<{ type: string }>(`studio:${c.project_id}:character`, "arrayBuffer");
        if (ref.value) form.set("input_reference", new File([ref.value], "character", { type: ref.metadata?.type ?? "image/png" }));
        const res = await fetch("https://api.openai.com/v1/videos", { method: "POST", headers: auth, body: form });
        const job = (await res.json()) as { id?: string; error?: { message?: string } };
        if (!res.ok || !job.id) return fail(job.error?.message ?? `OpenAI ${res.status}`);
        await env.DB.prepare("UPDATE content_clips SET job_id = ?, updated_at = ? WHERE id = ?").bind(job.id, now(), clipId).run();
        return again();
      }
      const res = await fetch(`https://api.openai.com/v1/videos/${c.job_id}`, { headers: auth });
      const job = (await res.json()) as { status?: string; error?: { message?: string } };
      if (job.status === "failed") return fail(job.error?.message ?? "Sora gagal membuat video");
      if (job.status !== "completed") return again();
      const video = await fetch(`https://api.openai.com/v1/videos/${c.job_id}/content`, { headers: auth });
      if (!video.ok) return fail(`Gagal mengunduh video (${video.status})`);
      await saveRendered(env, c, await video.arrayBuffer(), video.headers.get("content-type") ?? "video/mp4");
    } else {
      const auth = { Authorization: `Bearer ${env.XAI_API_KEY}`, "content-type": "application/json" };
      if (!c.job_id) {
        const res = await fetch("https://api.x.ai/v1/videos/generations", {
          method: "POST",
          headers: auth,
          body: JSON.stringify({
            model: env.GROK_VIDEO_MODEL || "grok-imagine-video-1.5",
            prompt: c.prompt,
            duration: c.seconds,
            aspect_ratio: "9:16",
            image: { url: await signedMediaUrl(env, `studio:${c.project_id}:character`) },
          }),
        });
        const job = (await res.json()) as { request_id?: string; error?: string | { message?: string } };
        if (!res.ok || !job.request_id) return fail(typeof job.error === "string" ? job.error : (job.error?.message ?? `xAI ${res.status}`));
        await env.DB.prepare("UPDATE content_clips SET job_id = ?, updated_at = ? WHERE id = ?").bind(job.request_id, now(), clipId).run();
        return again();
      }
      const res = await fetch(`https://api.x.ai/v1/videos/${c.job_id}`, { headers: auth });
      const job = (await res.json()) as { status?: string; video?: { url?: string }; error?: string };
      if (job.status === "failed" || job.status === "expired") return fail(job.error ?? `Grok: ${job.status}`);
      if (job.status !== "done" || !job.video?.url) return again();
      const video = await fetch(job.video.url);
      if (!video.ok) return fail(`Gagal mengunduh video (${video.status})`);
      await saveRendered(env, c, await video.arrayBuffer(), video.headers.get("content-type") ?? "video/mp4");
    }
  } catch (err) {
    await fail(String(err));
  }
}

async function saveRendered(env: Env, c: Clip, body: ArrayBuffer, type: string): Promise<void> {
  if (body.byteLength > 24 * 1024 * 1024) throw new Error("Video hasil lebih dari 24 MB, tidak muat di penyimpanan");
  await env.MEDIA.put(clipKey(c.id), body, { metadata: { type } });
  await env.DB.prepare("UPDATE content_clips SET status = 'done', media_key = ?, updated_at = ? WHERE id = ?").bind(clipKey(c.id), now(), c.id).run();
  await logActivity(env, "konten", "done", `Video adegan ${c.scene_no} jadi (${c.provider === "grok" ? "Grok" : "Sora"})`);
  // Kabari pemilik kalau semua klip proyek ini sudah jadi.
  const left = await env.DB.prepare(
    "SELECT count(*) AS n FROM content_clips WHERE project_id = ? AND provider = ? AND status NOT IN ('done','uploaded')",
  )
    .bind(c.project_id, c.provider)
    .first<{ n: number }>();
  if (!left?.n && env.OWNER_CHAT_ID) {
    const p = await env.DB.prepare("SELECT title FROM content_projects WHERE id = ?").bind(c.project_id).first<{ title: string }>();
    await new Telegram(env.TELEGRAM_BOT_TOKEN)
      .send(env.OWNER_CHAT_ID, `🎬 Semua klip video "${p?.title ?? "konten"}" sudah jadi. Lihat di website → Studio Konten.`)
      .catch(() => {});
  }
}

// --- Ekspor ke format Archify (workflow, schema v2) ---

/** Alur proyek sebagai IR workflow Archify (schema v2, maks 6 kolom), supaya bisa dirender jadi diagram interaktif resminya. */
export function archifyIR(p: NonNullable<Awaited<ReturnType<typeof getProject>>>) {
  const scenes = p.storyboard?.scenes ?? [];
  const provider = p.provider ?? "chatgpt";
  const STATUS = { prompt: "prompt siap", rendering: "dibuat…", done: "jadi", uploaded: "diunggah", failed: "gagal" } as const;
  // Archify membatasi 6 kolom: adegan dibagi rata ke maksimal 6 kelompok.
  const groups: Scene[][] = [];
  const size = Math.ceil(scenes.length / 6) || 1;
  for (let i = 0; i < scenes.length; i += size) groups.push(scenes.slice(i, i + size));
  const nodes: Record<string, unknown>[] = [
    { id: "customer", lane: "avatar", col: 0, type: "external", label: clip(p.avatar?.customer.name || "Avatar pelanggan", 26), sublabel: clip(p.avatar?.customer.age || "persona target", 20) },
    { id: "character", lane: "avatar", col: 1, type: "frontend", label: clip(p.avatar?.character.name || "Karakter video", 26), sublabel: clip(p.avatar?.character.role || "talent AI", 20) },
    { id: "product", lane: "produk", col: 2, type: "backend", label: clip(p.product?.product.name || "Produk", 26), sublabel: clip(p.product?.angle || "angle", 20) },
    { id: "hook", lane: "produk", col: 3, type: "backend", label: "Hook", sublabel: clip(p.product?.hooks[p.product.chosen_hook] || "belum dipilih", 20) },
  ];
  const edges: Record<string, unknown>[] = [
    { id: "customer_character", from: "customer", to: "character", label: "dipercaya oleh" },
    { id: "character_product", from: "character", to: "product", label: "memperkenalkan" },
    { id: "product_hook", from: "product", to: "hook", label: "dibuka dengan" },
  ];
  const mainPath = ["customer", "character", "product", "hook"];
  groups.forEach((g, i) => {
    const first = g[0].no;
    const last = g[g.length - 1].no;
    const id = `scene_${i + 1}`;
    const seconds = g.reduce((n, s) => n + s.seconds, 0);
    nodes.push({
      id,
      lane: "storyboard",
      col: i,
      type: "frontend",
      label: first === last ? `Adegan ${first}` : `Adegan ${first}–${last}`,
      sublabel: clip(`${seconds} dtk · ${g[0].on_screen_text || g[0].dialogue}`, 20),
    });
    // Lajur storyboard mulai lagi dari kolom 0, jadi rantai adegan berada di luar mainPath (Archify: mainPath harus maju).
    edges.push({ id: `to_${id}`, from: i ? `scene_${i}` : "hook", to: id, ...(i ? {} : { label: "jadi adegan" }) });
    const clips = g.map((s) => p.clips.find((c) => c.scene_no === s.no && c.provider === provider));
    const ready = clips.filter((c) => c && ["done", "uploaded"].includes(c.status)).length;
    nodes.push({
      id: `clip_${i + 1}`,
      lane: "hasil",
      col: i,
      type: ready === g.length ? "database" : "external",
      label: first === last ? `Klip ${first}` : `Klip ${first}–${last}`,
      sublabel: g.length === 1 && clips[0] ? STATUS[clips[0].status] : `${ready}/${g.length} jadi`,
    });
    edges.push({ id: `${id}_clip`, from: id, to: `clip_${i + 1}`, label: provider === "grok" ? "Grok" : "Sora" });
  });
  for (const n of nodes) n.width = 150;
  return {
    schema_version: 2,
    diagram_type: "workflow",
    meta: { title: clip(`Studio Konten — ${p.title}`, 80), quality_profile: "showcase", output: `studio-${p.id}.html` },
    lanes: [
      { id: "avatar", label: "Avatar" },
      { id: "produk", label: "Produk" },
      { id: "storyboard", label: "Storyboard" },
      { id: "hasil", label: "Hasil" },
    ],
    mainPath,
    nodes,
    edges,
  };
}

/** Catatan Second Brain berisi rangkuman proyek (dipanggil saat storyboard disetujui lewat API). */
export async function saveProjectNote(env: Env, id: number): Promise<number | null> {
  const p = await getProject(env, id);
  if (!p?.storyboard) return null;
  const sb = p.storyboard;
  const text = [
    `Avatar: ${p.avatar?.customer.name} (${p.avatar?.customer.age}) — karakter ${p.avatar?.character.name}`,
    `Produk: ${p.product?.product.name} · angle: ${p.product?.angle}`,
    `Hook: ${p.product?.hooks[p.product.chosen_hook]}`,
    "",
    ...sb.scenes.map((s) => `${s.no}. (${s.seconds}s) ${s.visual}\n   Dialog: ${s.dialogue}\n   Teks: ${s.on_screen_text}`),
    "",
    `Caption:\n${sb.caption}`,
  ].join("\n");
  const noteId = await db.addNote(env.DB, { title: `Storyboard: ${p.title}`, content: text, tags: "marketing, konten, studio" });
  await memory.indexNote(env, noteId);
  return noteId;
}
