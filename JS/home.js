// js/home.js
// Home: GPT-style sidebar, hero typing line, keyboard lights, S↔M highlight

document.addEventListener("DOMContentLoaded", () => {
  setupHeroTyping();
  setupKeyboardPressEffect();
  setupSidebarBehaviour();
  setupKeyboardLights();
  setupKeyHighlightCycle();
});

function setupHeroTyping() {
  const phrases = [
    "prepare for typing exams",
    "type real books professionally",
    "practice Hindi & English together"
  ];

  const dynamicEl = document.getElementById("hero-typing-dynamic");
  const cursorEl = document.querySelector(".hero-typing-cursor");
  if (!dynamicEl || !cursorEl) return;

  let index = 0;
  let charIndex = 0;
  let current = phrases[0];
  let deleting = false;

  function tick() {
    if (!deleting) {
      charIndex++;
      if (charIndex > current.length) {
        deleting = true;
        setTimeout(tick, 1200);
        return;
      }
    } else {
      charIndex--;
      if (charIndex <= 0) {
        deleting = false;
        index = (index + 1) % phrases.length;
        current = phrases[index];
      }
    }
    dynamicEl.textContent = current.slice(0, charIndex);
    setTimeout(tick, deleting ? 40 : 80);
  }

  tick();

  // Blink cursor
  setInterval(() => {
    cursorEl.classList.toggle("hidden");
  }, 500);
}

function setupKeyboardPressEffect() {
  const keys = document.querySelectorAll(".hero-keyboard .kbd-row span");
  keys.forEach((key) => {
    key.addEventListener("mousedown", () => {
      key.classList.add("kbd-pressed");
    });
    key.addEventListener("mouseup", () => {
      key.classList.remove("kbd-pressed");
    });
    key.addEventListener("mouseleave", () => {
      key.classList.remove("kbd-pressed");
    });
  });
}

function setupSidebarBehaviour() {
  const sidebar = document.getElementById("app-sidebar");
  const main = document.getElementById("app-main");
  const collapseBtn = document.getElementById("sidebar-collapse");
  if (!sidebar || !main || !collapseBtn) return;

  // Default expanded
  document.body.classList.add("sidebar-expanded");

  collapseBtn.addEventListener("click", () => {
    const expanded = document.body.classList.toggle("sidebar-expanded");
    document.body.classList.toggle("sidebar-collapsed", !expanded);
    collapseBtn.textContent = expanded ? "‹" : "›";
  });
}

function setupKeyboardLights() {
  const btn = document.getElementById("kbd-light-toggle");
  const keyboard = document.getElementById("hero-keyboard");
  if (!btn || !keyboard) return;

  btn.addEventListener("click", () => {
    keyboard.classList.toggle("lit");
  });
}

function setupKeyHighlightCycle() {
  const keys = document.querySelectorAll(".hero-keyboard .kbd-row span");
  if (!keys.length) return;

  let sKey = null;
  let mKey = null;
  keys.forEach((el) => {
    const t = el.textContent.trim().toUpperCase();
    if (t === "S") sKey = el;
    if (t === "M") mKey = el;
  });

  if (!sKey || !mKey) return;

  const cls = "kbd-active";
  sKey.classList.add(cls);

  setInterval(() => {
    if (sKey.classList.contains(cls)) {
      sKey.classList.remove(cls);
      mKey.classList.add(cls);
    } else {
      mKey.classList.remove(cls);
      sKey.classList.add(cls);
    }
  }, 2400); // ~2.4 sec switch S ↔ M
}