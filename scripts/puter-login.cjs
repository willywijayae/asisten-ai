// Login ke Puter lewat browser lalu cetak auth token ke stdout (tanpa newline),
// untuk langsung dialirkan ke `wrangler secret put PUTER_AUTH_TOKEN`.
const { getAuthToken } = require("@heyputer/puter.js/src/init.cjs");

console.error("Membuka browser untuk login Puter...");
getAuthToken().then((token) => {
  if (!token) {
    console.error("Token tidak didapat.");
    process.exit(1);
  }
  process.stdout.write(token);
  console.error("Token Puter didapat, menyimpan ke Cloudflare...");
  process.exit(0);
});
