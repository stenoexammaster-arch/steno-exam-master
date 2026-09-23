// admin-ui.js (Firebase v8 compatible)
// Small UI helpers: toast + confirm

(function(){
  function ensureToastRoot(){
    let root = document.getElementById("admin-toast-root");
    if (root) return root;
    root = document.createElement("div");
    root.id = "admin-toast-root";
    root.style.cssText = "position:fixed;right:16px;top:86px;z-index:99999;display:flex;flex-direction:column;gap:10px;";
    document.body.appendChild(root);
    return root;
  }

  function toast(message, type="info", timeout=2200){
    const root = ensureToastRoot();
    const el = document.createElement("div");
    const bg = type === "error" ? "rgba(127,29,29,.95)" : type === "success" ? "rgba(21,128,61,.95)" : "rgba(15,23,42,.95)";
    el.style.cssText = `min-width:260px;max-width:360px;padding:10px 12px;border-radius:14px;border:1px solid rgba(255,255,255,.10);background:${bg};color:#fff;box-shadow:0 18px 40px rgba(0,0,0,.55);font-weight:700;`;
    el.textContent = message;
    root.appendChild(el);
    setTimeout(()=>{ el.remove(); }, timeout);
  }

  function confirmBox({title="Confirm", message="Are you sure?", okText="OK", cancelText="Cancel"}){
    return new Promise((resolve)=>{
      const overlay = document.createElement("div");
      overlay.style.cssText = "position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,.55);display:grid;place-items:center;padding:16px;";
      const card = document.createElement("div");
      card.style.cssText = "width:min(520px,96vw);border-radius:16px;border:1px solid rgba(255,255,255,.12);background:rgba(2,6,23,.96);color:#e5e7eb;box-shadow:0 24px 70px rgba(0,0,0,.85);padding:14px;";
      card.innerHTML = `
        <div style="font-weight:900;font-size:16px;margin-bottom:6px;">${title}</div>
        <div style="color:#9ca3af;font-size:13px;line-height:1.5;margin-bottom:12px;">${message}</div>
        <div style="display:flex;gap:10px;justify-content:flex-end;flex-wrap:wrap;">
          <button type="button" class="btn small secondary" data-act="cancel">${cancelText}</button>
          <button type="button" class="btn small primary" data-act="ok">${okText}</button>
        </div>
      `;
      overlay.appendChild(card);
      document.body.appendChild(overlay);

      overlay.addEventListener("click",(e)=>{
        const btn = e.target.closest("button");
        if (!btn) return;
        const act = btn.dataset.act;
        overlay.remove();
        resolve(act === "ok");
      });
    });
  }

  window.ftAdminUI = { toast, confirmBox };
})();