import { AuthorizationError, CimdFetchError, type ConsentDescription } from "@cloudflare/workers-oauth-provider";
import type { Env } from "./env";
import { isLoggedIn } from "./auth";

// Halaman /authorize untuk konektor MCP: pemilik harus login (kode Telegram), lalu menyetujui aplikasi.

const escape = (v: string) => v.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

const SCOPE_LABEL: Record<string, string> = {
  mcp: "Baca & ubah tugas, catatan, profil, dan preferensi di Second Brain",
  offline_access: "Tetap terhubung tanpa login ulang",
};

function page(title: string, body: string, headers = new Headers()): Response {
  headers.set("content-type", "text/html; charset=utf-8");
  headers.set("cache-control", "no-store");
  headers.set("x-frame-options", "DENY");
  headers.set("content-security-policy", "frame-ancestors 'none'");
  return new Response(
    `<!doctype html><html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>${escape(title)}</title>
<style>
:root{--bg:#f6f6f3;--card:#fff;--fg:#1a1c21;--muted:#676c75;--line:#e3e3dd;--accent:#4f46e5;--accent-fg:#fff;--warn:#b45309;--warn-bg:#fdf3e2}
@media (prefers-color-scheme:dark){:root{--bg:#0e1014;--card:#161920;--fg:#e6e8ec;--muted:#979ead;--line:#2a2f3a;--accent:#8b8cf8;--accent-fg:#0e1014;--warn:#fbbf24;--warn-bg:#362a12}}
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:var(--bg);color:var(--fg);font:15px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;padding:16px}
.card{width:100%;max-width:420px;background:var(--card);border:1px solid var(--line);border-radius:16px;padding:24px}
h1{font-size:18px;margin:0 0 8px}p{margin:8px 0;color:var(--muted)}b{color:var(--fg)}
ul{padding-left:18px;margin:12px 0}li{margin:4px 0}
.warn{background:var(--warn-bg);color:var(--warn);border-radius:8px;padding:8px 10px;font-size:13px}
.row{display:flex;gap:8px;margin-top:16px}button{flex:1;height:40px;border-radius:10px;border:1px solid var(--line);background:var(--card);color:var(--fg);font:inherit;font-weight:600;cursor:pointer}
button.primary{background:var(--accent);color:var(--accent-fg);border-color:var(--accent)}button:disabled{opacity:.5}
input{width:100%;height:44px;border:1px solid var(--line);border-radius:10px;background:var(--card);color:var(--fg);font:600 22px ui-monospace,monospace;letter-spacing:.4em;text-align:center;margin-top:12px}
.err{color:#d92d20;font-size:13px;min-height:1em}
</style></head><body><main class="card">${body}</main></body></html>`,
    { headers },
  );
}

/** Belum login: login dengan kode Telegram di halaman ini, lalu muat ulang. */
function loginPage(): Response {
  return page(
    "Masuk — Second Brain",
    `<h1>Masuk dulu</h1>
<p>Sebuah aplikasi ingin terhubung ke Second Brain kamu. Masuk dengan kode yang dikirim ke Telegram.</p>
<div class="row"><button class="primary" id="send">Kirim kode ke Telegram</button></div>
<div id="step2" hidden><input id="code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="••••••">
<div class="row"><button class="primary" id="verify">Masuk</button></div></div>
<p class="err" id="err"></p>
<script>
const $=(id)=>document.getElementById(id);
const post=(p,b)=>fetch('/api'+p,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(b||{})}).then(async r=>{const d=await r.json().catch(()=>({}));if(!r.ok&&r.status!==429)throw new Error(d.error||r.status);return d});
$('send').onclick=async()=>{$('send').disabled=true;$('err').textContent='';try{await post('/auth/request');}catch(e){$('err').textContent=e.message}$('step2').hidden=false;$('code').focus();$('send').disabled=false;$('send').textContent='Kirim ulang kode'};
$('verify').onclick=async()=>{$('verify').disabled=true;$('err').textContent='';try{await post('/auth/verify',{code:$('code').value});location.reload()}catch(e){$('err').textContent=e.message;$('verify').disabled=false}};
$('code').onkeydown=(e)=>{if(e.key==='Enter')$('verify').click()};
</script>`,
  );
}

function consentPage(d: ConsentDescription, handle: string, headers: Headers): Response {
  const scopes = (d.scope.length ? d.scope : ["mcp"])
    .map((s) => `<li>${escape(SCOPE_LABEL[s] ?? s)}</li>`)
    .join("");
  return page(
    `Izinkan ${d.clientName}?`,
    `<h1>Izinkan <b>${escape(d.clientName)}</b> mengakses Second Brain?</h1>
<p>${d.clientDomain ? `Diterbitkan oleh <b>${escape(d.clientDomain)}</b>.` : "Nama aplikasi ini didaftarkan sendiri oleh aplikasinya (tidak terverifikasi)."}
Akses akan dikirim ke <b>${escape(d.redirectHost)}</b>.</p>
${d.redirectIsLoopback ? `<p class="warn">Akses dikirim ke aplikasi di komputermu. Lanjutkan hanya kalau kamu baru saja memulai proses ini.</p>` : ""}
<p>Aplikasi ini akan bisa:</p><ul>${scopes}</ul>
<p>Kalau kamu tidak sedang menghubungkan Claude atau aplikasi lain, pilih <b>Tolak</b>.</p>
<form method="post"><input type="hidden" name="handle" value="${escape(handle)}">
<div class="row"><button name="decision" value="deny">Tolak</button><button class="primary" name="decision" value="approve">Izinkan</button></div></form>`,
    headers,
  );
}

export async function handleAuthorize(req: Request, env: Env): Promise<Response> {
  const oauth = env.OAUTH_PROVIDER;
  try {
    if (!(await isLoggedIn(env, req))) {
      // Form POST tanpa sesi tidak pernah valid; GET → tampilkan login.
      return req.method === "POST" ? new Response("Sesi habis, muat ulang halaman.", { status: 401 }) : loginPage();
    }

    if (req.method === "GET") {
      const request = await oauth.parseAuthRequest(req);
      const details = await oauth.describeConsent(request);
      const consent = await oauth.beginConsent(request);
      return consentPage(details, consent.handle, consent.headers);
    }

    if (req.method === "POST") {
      const form = await req.formData();
      const handle = String(form.get("handle") ?? "");
      if (form.get("decision") !== "approve") {
        const denied = await oauth.denyConsent(req, handle);
        return new Response(null, { status: 302, headers: denied.headers });
      }
      const approved = await oauth.approveConsent(req, handle);
      const { redirectTo } = await oauth.completeAuthorization({
        request: approved.request,
        userId: "owner",
        metadata: { approvedAt: new Date().toISOString() },
        scope: approved.request.scope,
        props: { userId: "owner" },
      });
      approved.headers.set("Location", redirectTo);
      return new Response(null, { status: 302, headers: approved.headers });
    }

    return new Response("Method not allowed", { status: 405 });
  } catch (error) {
    if (error instanceof AuthorizationError && error.redirectTo) return Response.redirect(error.redirectTo, 302);
    if (error instanceof AuthorizationError || error instanceof CimdFetchError) {
      const message = error instanceof AuthorizationError ? error.description : "Aplikasi ini tidak bisa diverifikasi.";
      return page("Gagal", `<h1>Tidak bisa melanjutkan</h1><p>${escape(message ?? "Permintaan tidak valid.")}</p><p>Coba ulangi dari aplikasinya.</p>`);
    }
    throw error;
  }
}
