import type { CashfreeMode } from "./billing";

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Safe to embed inside a <script> block.
function jsString(s: string): string {
  return JSON.stringify(s).replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026");
}

const STYLE = `
  *{box-sizing:border-box}
  body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;
       background:#0F0F0F;color:#fff;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;padding:24px}
  .card{background:#1A1A1A;border:1px solid #3A3A3A;border-radius:20px;padding:32px 24px;max-width:380px;width:100%;text-align:center}
  h1{font-size:22px;margin:16px 0 8px}
  p{color:#A0A0A0;font-size:14px;line-height:1.55;margin:6px 0}
  .icon{font-size:52px;line-height:1}
  .ok{color:#22C55E}.warn{color:#F59E0B}.bad{color:#EF4444}
  .btn{display:inline-block;margin-top:20px;padding:13px 22px;border-radius:12px;background:#F59E0B;color:#0F0F0F;
       font-weight:700;font-size:15px;text-decoration:none;border:0;cursor:pointer}
  .spin{width:34px;height:34px;border:4px solid #3A3A3A;border-top-color:#F59E0B;border-radius:50%;
        margin:0 auto;animation:s 1s linear infinite}
  @keyframes s{to{transform:rotate(360deg)}}
`;

function shell(title: string, body: string, head = ""): string {
  return `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>${STYLE}</style>
${head}
</head><body><div class="card">${body}</div></body></html>`;
}

// Opens Cashfree's hosted checkout for an order we created.
export function renderCheckoutPage(opts: { paymentSessionId: string; mode: CashfreeMode; amount: number }): string {
  const body = `
    <div class="spin" id="spin"></div>
    <h1 id="title">Opening secure payment…</h1>
    <p id="msg">Subscription — ₹${opts.amount.toLocaleString("en-IN")} / month</p>
    <button class="btn" id="retry" style="display:none" onclick="start()">Try again</button>
    <script>
      var SESSION = ${jsString(opts.paymentSessionId)};
      function fail(m){
        document.getElementById('spin').style.display='none';
        document.getElementById('title').textContent='Could not open payment';
        document.getElementById('msg').textContent=m||'Please check your connection and try again.';
        document.getElementById('retry').style.display='inline-block';
      }
      function start(){
        try{
          document.getElementById('spin').style.display='block';
          document.getElementById('retry').style.display='none';
          var cashfree = Cashfree({ mode: ${jsString(opts.mode)} });
          cashfree.checkout({ paymentSessionId: SESSION, redirectTarget: "_self" }).then(function(r){
            if (r && r.error) fail(r.error.message);
          });
        }catch(e){ fail(e && e.message); }
      }
      window.addEventListener('load', start);
    </script>`;
  return shell("Pay subscription", body, `<script src="https://sdk.cashfree.com/js/v3/cashfree.js"></script>`);
}

export type ReturnState = "PAID" | "PENDING" | "FAILED" | "NOT_FOUND";

// Shown in the phone's browser after Cashfree redirects back. The app itself
// picks the new status up as soon as the user returns to it.
export function renderReturnPage(state: ReturnState, orderId: string): string {
  const openApp = `<a class="btn" href="myapp://">Open the app</a>`;
  const footer = `<p style="margin-top:18px;font-size:12px">You can also just close this window and go back to the app.</p>`;
  if (state === "PAID") {
    return shell(
      "Payment successful",
      `<div class="icon ok">✓</div><h1>Payment successful</h1>
       <p>Your subscription has been extended by one month. Thank you!</p>${openApp}${footer}`
    );
  }
  if (state === "PENDING") {
    return shell(
      "Payment processing",
      `<div class="icon warn">…</div><h1>Payment processing</h1>
       <p>We haven't received confirmation from your bank yet. This usually takes under a minute —
       your access will update automatically. If money was deducted it will not be lost.</p>${openApp}${footer}
       <p style="font-size:11px">Ref: ${esc(orderId)}</p>`
    );
  }
  if (state === "NOT_FOUND") {
    return shell(
      "Order not found",
      `<div class="icon bad">!</div><h1>Order not found</h1>
       <p>We couldn't find this payment. Please go back to the app and start again.</p>${openApp}`
    );
  }
  return shell(
    "Payment not completed",
    `<div class="icon bad">✕</div><h1>Payment not completed</h1>
     <p>The payment didn't go through and you have not been charged. Go back to the app and try again.</p>${openApp}${footer}`
  );
}

export function renderMessagePage(title: string, message: string): string {
  return shell(title, `<div class="icon warn">!</div><h1>${esc(title)}</h1><p>${esc(message)}</p>`);
}
