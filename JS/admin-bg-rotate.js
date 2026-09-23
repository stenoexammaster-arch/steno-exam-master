(function(){
  function pad2(n){ return String(n).padStart(2,"0"); }

  document.addEventListener("DOMContentLoaded", () => {
    const el = document.getElementById("daily-bg");
    if (!el) return;

    const d = new Date();
    const day = d.getDate(); // 1..31
    const file = `assets/admin-bg/bg-${pad2(day)}.jpg`; // change extension if needed

    el.style.backgroundImage = `url("${file}")`;
  });
})();