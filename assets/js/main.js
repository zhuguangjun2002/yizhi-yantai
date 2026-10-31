/* ==========================================================================
   《一颗苹果的一百五十年》— 滚动叙事控制
   职责只剩两件：切场景、演第五章的收缩。其余交给 CSS。
   ========================================================================== */

(function () {
  'use strict';

  const scrolly  = document.getElementById('scrolly');
  const progress = document.getElementById('progressBar');
  const frame    = document.getElementById('paperFrame');
  const stageInner = document.getElementById('stageInner');

  const chapters = Array.from(document.querySelectorAll('.ch'));
  const navLinks = Array.from(document.querySelectorAll('.rail a'));

  /** 章节 → 对应场景。用 Map 而不是数组，避免依赖 DOM 顺序。 */
  const sceneByChapter = new Map();
  chapters.forEach((chapter) => {
    const scene = document.getElementById('scene-' + chapter.dataset.chapter);
    if (scene) sceneByChapter.set(chapter, scene);
  });

  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

  /* ------------------------------------------------------------------
     场景摆放：桌面端钉在右侧，移动端回到每一章里
     移动端没法钉——正文会从画底下钻过去，压成一团红。
     ------------------------------------------------------------------ */
  const mobileQuery = window.matchMedia('(max-width: 900px)');

  const sceneSlots = new Map();
  chapters.forEach((chapter) => {
    const slot = document.createElement('div');
    slot.className = 'ch-scene';
    chapter.insertBefore(slot, chapter.firstChild);
    sceneSlots.set(chapter, slot);
  });

  function syncScenePlacement() {
    chapters.forEach((chapter) => {
      const scene = sceneByChapter.get(chapter);
      if (!scene) return;
      const destination = mobileQuery.matches ? sceneSlots.get(chapter) : stageInner;
      if (scene.parentElement !== destination) destination.appendChild(scene);
    });
  }

  syncScenePlacement();
  mobileQuery.addEventListener('change', () => {
    syncScenePlacement();
    requestUpdate();
  });

  let activeChapter = null;
  let revealAmount = 0;
  let ticking = false;

  /* ------------------------------------------------------------------
     核心：每帧只读一次布局，然后只写样式
     ------------------------------------------------------------------ */
  function update() {
    ticking = false;

    const viewportHeight = window.innerHeight;
    const scrollTop = window.scrollY;
    const docHeight = document.documentElement.scrollHeight;

    // 顶部进度条
    const docProgress = clamp(scrollTop / Math.max(1, docHeight - viewportHeight), 0, 1);
    progress.style.width = (docProgress * 100).toFixed(2) + '%';

    // 舞台只在正文区间出现：离开首页与页脚时收起
    const scrollyRect = scrolly.getBoundingClientRect();
    const stageOn = scrollyRect.top < viewportHeight * 0.6
                 && scrollyRect.bottom > viewportHeight * 0.72;
    document.body.classList.toggle('stage-on', stageOn);

    // 取「最后一个顶边越过焦点线的章节」。不找包含焦点线的那一个——
    // 否则滚太快、焦点线正好落在两章之间时，场景会卡在上一集不动。
    const focusLine = viewportHeight * 0.45;
    let current = chapters[0];
    for (const chapter of chapters) {
      if (chapter.getBoundingClientRect().top <= focusLine) current = chapter;
      else break;
    }

    if (current && current !== activeChapter) {
      setActiveChapter(current);
    }

    if (activeChapter) {
      const rect = activeChapter.getBoundingClientRect();
      const chapterProgress = clamp((focusLine - rect.top) / Math.max(1, rect.height), 0, 1);

      // 反转挂在最后一章上，而不是写死"第 5 章"——加章节时不用回来改
      if (activeChapter === chapters[chapters.length - 1]) {
        applyReveal(chapterProgress);
      } else if (revealAmount > 0) {
        applyReveal(0);
      }
    }
  }

  function setActiveChapter(chapter) {
    activeChapter = chapter;

    const scene = sceneByChapter.get(chapter);
    sceneByChapter.forEach((sceneEl) => sceneEl.classList.toggle('is-active', sceneEl === scene));

    const index = chapter.dataset.chapter;
    navLinks.forEach((link) => link.classList.toggle('is-active', link.dataset.nav === index));
  }

  /* ------------------------------------------------------------------
     第五章的反转：整块画面收缩成一张纸
     图里已经画着剪刀，就别再叠一把上去抢戏了。
     ------------------------------------------------------------------ */
  function applyReveal(progressValue) {
    const amount = clamp((progressValue - 0.1) / 0.52, 0, 1);
    revealAmount = amount;

    document.body.classList.toggle('is-reveal', amount > 0.02);
    frame.style.transform = 'scale(' + (1 - amount * 0.42).toFixed(3) + ')';
  }

  /* ------------------------------------------------------------------
     事件绑定
     ------------------------------------------------------------------ */
  function requestUpdate() {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(update);
  }

  window.addEventListener('scroll', requestUpdate, { passive: true });
  window.addEventListener('resize', requestUpdate);
  window.addEventListener('load', requestUpdate);

  // 正文段落进入视口时轻轻浮起
  if ('IntersectionObserver' in window && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible');
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -12% 0px' });

    document.querySelectorAll('.ch > *').forEach((el) => observer.observe(el));
  } else {
    document.querySelectorAll('.ch > *').forEach((el) => el.classList.add('is-visible'));
  }

  update();
})();
