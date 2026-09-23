/**
 * Логика лендинга конкурса.
 * Тексты и настройки берутся из CONFIG (config.js).
 * Здесь — только поведение: шаги квиза, валидация, сохранение прогресса.
 */

(function () {
  "use strict";

  // ---------------------------------------------------------------------
  // Состояние
  // ---------------------------------------------------------------------
  const STORAGE_KEY = "pravexKonkursState_v1";

  const defaultState = {
    step1: null,
    topic: null,
    videoMeta: null, // {name, size, duration, width, height} — сам файл в браузере не сохраняется
    videoViewUrl: "", // защищённая ссылка на файл в VK Object Storage — уходит в письмо на почту (живёт 6 дней)
    videoObjectKey: "", // путь к файлу в бакете — чтобы найти видео и после истечения ссылки
    contacts: { name: "", phone: "", email: "", city: "", channel: null },
    consents: {
      rules: false,
      pdn: false,
      pdnDistribution: false,
      image: false,
      license: false
    },
    utm: {},
    applicationNumber: null
  };

  let state = loadState();
  let videoFile = null; // File — живёт только в памяти вкладки
  let currentUploadXhr = null; // текущая загрузка на сервер, чтобы можно было её оборвать
  let isDuplicateSubmission = false;

  // Черновик анкеты хранится в sessionStorage: он живёт только пока открыта вкладка
  // (обновление страницы его не сбрасывает, закрытие вкладки — стирает). Так на общем
  // компьютере следующий человек не увидит чужие ФИО, телефон и согласия.
  function loadState() {
    // Старые черновики раньше лежали в localStorage и переживали закрытие браузера — стираем их
    try { localStorage.removeItem(STORAGE_KEY); } catch (e) { /* noop */ }
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      if (!raw) return structuredClone(defaultState);
      const parsed = JSON.parse(raw);
      const merged = Object.assign(structuredClone(defaultState), parsed);
      // Новые поля согласий, которых нет в ранее сохранённом черновике
      merged.consents = Object.assign(structuredClone(defaultState.consents), parsed.consents || {});
      return merged;
    } catch (e) {
      return structuredClone(defaultState);
    }
  }

  function saveState() {
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) {
      /* тихо игнорируем — например, приватный режим браузера */
    }
  }

  // ---------------------------------------------------------------------
  // Утилиты
  // ---------------------------------------------------------------------
  function $(id) { return document.getElementById(id); }

  function el(tag, opts) {
    const node = document.createElement(tag);
    if (opts) {
      if (opts.className) node.className = opts.className;
      if (opts.html !== undefined) node.innerHTML = opts.html;
      if (opts.text !== undefined) node.textContent = opts.text;
      if (opts.attrs) Object.entries(opts.attrs).forEach(([k, v]) => node.setAttribute(k, v));
    }
    return node;
  }

  function formatBytes(bytes) {
    const mb = bytes / (1024 * 1024);
    return mb.toFixed(1).replace(".0", "") + " МБ";
  }

  function formatDuration(sec) {
    const m = Math.floor(sec / 60);
    const s = Math.round(sec % 60);
    return `${m}:${String(s).padStart(2, "0")}`;
  }

  function metrikaGoal(name) {
    if (window.ym && CONFIG.yandexMetrikaId) {
      try { window.ym(Number(CONFIG.yandexMetrikaId), "reachGoal", name); } catch (e) { /* noop */ }
    }
    console.debug("[metrika goal]", name);
  }

  function getUtmFromUrl() {
    const params = new URLSearchParams(window.location.search);
    const keys = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"];
    const out = {};
    keys.forEach((k) => { if (params.get(k)) out[k] = params.get(k); });
    return out;
  }

  function nowMsk() {
    return new Date().toLocaleString("ru-RU", { timeZone: "Europe/Moscow" });
  }

  // ---------------------------------------------------------------------
  // Иконки для карточек темы (step 2)
  // ---------------------------------------------------------------------
  const ICONS = {
    spark: '<svg class="option-icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12 2l1.8 5.6L19 9l-5.2 1.4L12 16l-1.8-5.6L5 9l5.2-1.4L12 2z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>',
    bulb: '<svg class="option-icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M9 18h6M10 21h4M12 3a6 6 0 00-3.5 10.9c.5.4.8 1 .8 1.6V16h5.4v-.5c0-.6.3-1.2.8-1.6A6 6 0 0012 3z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    sun: '<svg class="option-icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="12" cy="12" r="4" stroke="currentColor" stroke-width="1.5"/><path d="M12 2v2M12 20v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M2 12h2M20 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
    dice: '<svg class="option-icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="3" y="3" width="18" height="18" rx="3" stroke="currentColor" stroke-width="1.5"/><circle cx="8" cy="8" r="1.2" fill="currentColor"/><circle cx="16" cy="8" r="1.2" fill="currentColor"/><circle cx="12" cy="12" r="1.2" fill="currentColor"/><circle cx="8" cy="16" r="1.2" fill="currentColor"/><circle cx="16" cy="16" r="1.2" fill="currentColor"/></svg>'
  };

  // ---------------------------------------------------------------------
  // Рендер статичных блоков (hero, how-to, faq)
  // ---------------------------------------------------------------------
  function renderStatic() {
    $("heroTitle").textContent = CONFIG.heroTitle;
    $("heroSubtitle").textContent = CONFIG.heroSubtitle;
    $("headerPhone").textContent = CONFIG.organizerPhone;
    $("headerPhone").href = CONFIG.organizerPhoneHref;
    $("logoLink").href = CONFIG.siteUrl;
    $("headerBadge").textContent = CONFIG.headerBadge;
    $("headerBadge").hidden = !CONFIG.headerBadge;
    $("heroKicker").textContent = CONFIG.heroKicker;
    $("heroKicker").hidden = !CONFIG.heroKicker;
    $("startBtn").textContent = CONFIG.heroCtaLabel;
    $("startBtn2").textContent = CONFIG.heroCtaLabel;
    $("rulesLinkBtn").textContent = CONFIG.heroRulesLabel;

    const badgesWrap = $("heroBadges");
    badgesWrap.innerHTML = "";
    CONFIG.heroBadges.forEach((b) => {
      const badge = el("div", { className: "hero-badge" + (b.accent ? " hero-badge-accent" : "") });
      badge.appendChild(el("span", { className: "badge-label", text: b.label }));
      badge.appendChild(el("span", { className: "badge-value", text: b.value }));
      badgesWrap.appendChild(badge);
    });

    const disclaimerBase = CONFIG.adDisclaimerTemplate
      .replace("{start}", formatDateRu(CONFIG.contestStartDate))
      .replace("{end}", formatDateRu(CONFIG.contestEndDate))
      .replace("{deadline}", formatDateTimeRu(CONFIG.submissionDeadline))
      .replace("{organizer}", CONFIG.organizerName)
      .replace("{prizes}", CONFIG.prizesDisclaimerText)
      .replace(/\.\.(?!\.)/g, "."); // "г.." после даты → "г."
    const footerDisclaimer = $("footerDisclaimer");
    footerDisclaimer.textContent = "";
    footerDisclaimer.appendChild(document.createTextNode(disclaimerBase + " "));
    const rulesInlineLink = el("a", { text: CONFIG.adDisclaimerLinkLabel, attrs: { href: CONFIG.rulesUrl, target: "_blank", rel: "noopener" } });
    footerDisclaimer.appendChild(rulesInlineLink);

    initHeroSlider();

    // Номинации — карточки из тем шага 2
    $("nominationsTitle").textContent = CONFIG.nominationsTitle;
    $("nominationsLead").textContent = CONFIG.nominationsLead;
    const nominationsGrid = $("nominationsGrid");
    nominationsGrid.innerHTML = "";
    CONFIG.topics.filter((t) => t.desc).forEach((t, i) => {
      const card = el("div", { className: "nomination-card", attrs: { role: "button", tabindex: "0" } });
      card.appendChild(el("span", { className: "nomination-tag", text: "Номинация " + (i + 1) }));
      card.appendChild(el("h3", { text: t.label }));
      card.appendChild(el("p", { text: t.desc }));
      card.addEventListener("click", () => startQuizWithTopic(t.id));
      card.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); startQuizWithTopic(t.id); }
      });
      nominationsGrid.appendChild(card);
    });

    // Как участвовать
    const howGrid = $("howGrid");
    howGrid.innerHTML = "";
    CONFIG.howItWorks.forEach((step, i) => {
      const card = el("div", { className: "step-card" });
      card.appendChild(el("span", { className: "step-num", text: String(i + 1) }));
      card.appendChild(el("h3", { text: step.title }));
      card.appendChild(el("p", { text: step.text.replace("{results}", CONFIG.resultsDate) }));
      howGrid.appendChild(card);
    });

    // FAQ
    const faqList = $("faqList");
    faqList.innerHTML = "";
    CONFIG.faq.forEach((item) => {
      const details = el("details", { className: "faq-item" });
      const summary = el("summary", { className: "faq-question" });
      summary.appendChild(el("span", { text: item.q }));
      summary.appendChild(el("span", {
        className: "chevron",
        html: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M6 9l6 6 6-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>'
      }));
      details.appendChild(summary);
      details.appendChild(el("div", { className: "faq-answer", text: item.a.replace("{results}", CONFIG.resultsDate).replace("{votingDates}", CONFIG.votingDates) }));
      faqList.appendChild(details);
    });

    // Footer
    $("footerOrganizer").textContent = CONFIG.organizerName;
    $("footerRequisites").textContent = CONFIG.organizerRequisites;
    $("footerPhone").textContent = CONFIG.organizerPhone;
    $("footerPhone").href = CONFIG.organizerPhoneHref;
    $("footerRules").href = CONFIG.rulesUrl;
    $("footerRules").target = "_blank";
    $("footerRules").rel = "noopener";
    $("footerPrivacy").href = CONFIG.privacyUrl;
    $("footerPrivacy").target = "_blank";
    $("footerPrivacy").rel = "noopener";
    $("cookiePrivacyLink").href = CONFIG.privacyUrl;
    $("cookiePrivacyLink").target = "_blank";
    $("cookiePrivacyLink").rel = "noopener";

    // Демо-баннер
    $("demoBanner").hidden = !!CONFIG.emailDeliveryConfigured;

    // Проверка дедлайна
    const deadline = new Date(CONFIG.submissionDeadline);
    if (Date.now() > deadline.getTime()) {
      $("heroSection").hidden = true;
      $("closedSection").hidden = false;
      $("closedTitle").textContent = CONFIG.closedTitle;
      $("closedText").textContent = CONFIG.closedText.replace("{results}", CONFIG.resultsDate);
      $("startBtn2").disabled = true;
      $("startBtn2").textContent = "Приём завершён";
    }
  }

  function formatDateRu(dateStr) {
    const d = new Date(dateStr);
    return d.toLocaleDateString("ru-RU", { day: "2-digit", month: "long", year: "numeric", timeZone: "Europe/Moscow" });
  }
  function formatDateTimeRu(dateStr) {
    const d = new Date(dateStr);
    return d.toLocaleDateString("ru-RU", { day: "2-digit", month: "long", year: "numeric", timeZone: "Europe/Moscow" });
  }

  // ---------------------------------------------------------------------
  // Рендер квиза
  // ---------------------------------------------------------------------
  function renderQuizStatic() {
    // Шаг 1
    $("q1Question").textContent = CONFIG.step1Question;
    const q1Wrap = $("q1Options");
    q1Wrap.innerHTML = "";
    CONFIG.step1Options.forEach((opt) => {
      q1Wrap.appendChild(buildOptionCard(opt.label, null, () => selectStep1(opt.id), () => state.step1 === opt.id));
    });

    // Шаг 2
    $("q2Question").textContent = CONFIG.step2Question;
    const q2Wrap = $("q2Options");
    q2Wrap.innerHTML = "";
    CONFIG.topics.forEach((t) => {
      q2Wrap.appendChild(buildOptionCard(t.label, ICONS[t.icon], () => selectTopic(t.id), () => state.topic === t.id));
    });

    // Шаг 4
    $("q4Title").textContent = CONFIG.step4Title;
    const rulesList = $("filmingRulesList");
    rulesList.innerHTML = "";
    CONFIG.filmingRules.forEach((r) => rulesList.appendChild(el("li", { text: r })));

    const dontList = $("dontList");
    dontList.innerHTML = "";
    CONFIG.videoDontList.forEach((r) => dontList.appendChild(el("li", { text: r })));

    $("videoReadyBtn").textContent = CONFIG.videoReadyLabel;
    $("filmLaterBtn").textContent = CONFIG.filmLaterLabel;
    $("laterTitle").textContent = CONFIG.filmLaterTitle;
    $("laterText").textContent = CONFIG.filmLaterText;

    // Шаг 5
    $("q5Question").textContent = CONFIG.step5Question;
    $("uploadHint").textContent = "";
    $("dzHint").textContent = CONFIG.uploadHint;

    // Шаг "Согласия"
    $("consentsTitle").textContent = CONFIG.consentsTitle;
    $("consentsNote").textContent = CONFIG.consentsNote;

    // Шаг 6
    $("q6Title").textContent = CONFIG.step6Title;
    const channelGrid = $("channelGrid");
    channelGrid.innerHTML = "";
    CONFIG.contactChannels.forEach((ch) => {
      const chip = el("div", { className: "channel-chip", text: ch, attrs: { role: "button", tabindex: "0" } });
      chip.addEventListener("click", () => {
        state.contacts.channel = ch;
        saveState();
        renderChannelSelection();
      });
      chip.dataset.channel = ch;
      channelGrid.appendChild(chip);
    });

    renderConsentsBlock();

    // Финальный экран
    $("finalTitle").textContent = CONFIG.finalTitle;
    $("shareBtn").textContent = CONFIG.shareLabel;

    // Восстановление сохранённых контактных полей
    $("fPhone").value = state.contacts.phone || "";
    $("fEmail").value = state.contacts.email || "";
    ["fPhone", "fEmail"].forEach((id) => {
      $(id).addEventListener("input", (e) => {
        const map = { fPhone: "phone", fEmail: "email" };
        state.contacts[map[id]] = e.target.value;
        saveState();
      });
    });

    // Шаг "Данные для публикации"
    $("pubTitle").textContent = CONFIG.pubTitle;
    $("pFio").value = state.contacts.name || "";
    $("pCity").value = state.contacts.city || "";
    $("pFio").addEventListener("input", (e) => { state.contacts.name = e.target.value; saveState(); });
    $("pCity").addEventListener("input", (e) => { state.contacts.city = e.target.value; saveState(); });
    $("pubNote").textContent = CONFIG.pubNote;
  }

  // Слайдер фото в баннере: автопрокрутка, точки, свайп; на паузе при наведении/фокусе
  function initHeroSlider() {
    const slides = CONFIG.heroSlides || [];
    const slidesWrap = $("heroSlides");
    const dotsWrap = $("heroDots");
    if (!slides.length) { $("heroSlider").hidden = true; return; }

    const imgs = slides.map((slide, i) => {
      const img = el("img", { className: "hero-slide", attrs: { src: slide.src, alt: slide.alt || "", width: "1200", height: "900", decoding: "async" } });
      if (i > 0) img.loading = "lazy";
      slidesWrap.appendChild(img);
      return img;
    });
    const dots = slides.map((slide, i) => {
      const dot = el("button", { className: "hero-dot", attrs: { type: "button", "aria-label": "Фото " + (i + 1) + " из " + slides.length } });
      dot.addEventListener("click", () => { show(i); restart(); });
      dotsWrap.appendChild(dot);
      return dot;
    });
    dotsWrap.hidden = slides.length < 2;

    let current = 0;
    let timer = null;

    function show(index) {
      current = (index + slides.length) % slides.length;
      imgs.forEach((img, i) => {
        img.classList.toggle("is-active", i === current);
        img.setAttribute("aria-hidden", i === current ? "false" : "true");
      });
      dots.forEach((dot, i) => dot.classList.toggle("is-active", i === current));
    }
    function stop() { if (timer) { clearInterval(timer); timer = null; } }
    function start() {
      if (slides.length < 2 || timer) return;
      if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
      timer = setInterval(() => show(current + 1), CONFIG.heroSlideIntervalMs || 4500);
    }
    function restart() { stop(); start(); }

    const box = $("heroSlider");
    box.addEventListener("mouseenter", stop);
    box.addEventListener("mouseleave", start);
    box.addEventListener("focusin", stop);
    box.addEventListener("focusout", start);
    document.addEventListener("visibilitychange", () => { if (document.hidden) stop(); else start(); });

    let touchX = null;
    box.addEventListener("touchstart", (e) => { touchX = e.touches[0].clientX; stop(); }, { passive: true });
    box.addEventListener("touchend", (e) => {
      if (touchX !== null) {
        const dx = e.changedTouches[0].clientX - touchX;
        if (Math.abs(dx) > 40) show(current + (dx < 0 ? 1 : -1));
      }
      touchX = null;
      start();
    });

    show(0);
    start();
  }

  function buildOptionCard(label, iconHtml, onClick, isSelectedFn, desc) {
    const card = el("button", { className: "option-card", attrs: { type: "button" } });
    if (iconHtml) {
      const iconWrap = el("span");
      iconWrap.innerHTML = iconHtml;
      card.appendChild(iconWrap.firstChild);
    }
    const textWrap = el("span", { className: "option-text" });
    textWrap.appendChild(document.createTextNode(label));
    if (desc) textWrap.appendChild(el("small", { text: desc }));
    card.appendChild(textWrap);
    if (isSelectedFn()) card.classList.add("selected");
    card.addEventListener("click", () => { onClick(); });
    return card;
  }

  function selectStep1(id) {
    state.step1 = id;
    saveState();
    refreshOptionSelection("q1Options", (idx) => CONFIG.step1Options[idx].id === id);
    $("q1NextBtn").disabled = false;
  }

  function selectTopic(id) {
    state.topic = id;
    saveState();
    refreshOptionSelection("q2Options", (idx) => CONFIG.topics[idx].id === id);
    $("q2NextBtn").disabled = false;
  }

  function refreshOptionSelection(wrapId, matchFn) {
    const wrap = $(wrapId);
    Array.from(wrap.children).forEach((child, idx) => {
      child.classList.toggle("selected", matchFn(idx));
    });
  }

  function renderChannelSelection() {
    Array.from($("channelGrid").children).forEach((chip) => {
      chip.classList.toggle("selected", chip.dataset.channel === state.contacts.channel);
    });
  }

  // Под капотом по-прежнему пять отдельных флагов (нужны для валидации и письма),
  // но в интерфейсе они объединены в 2 галочки: «Правила» и «Все остальные согласия».
  // Групповая галочка pdn/pdnDistribution/image/license всегда выставляется одним
  // значением сразу для всех четырёх флагов.
  const COMBINED_CONSENT_KEYS = ["pdn", "pdnDistribution", "image", "license"];

  function isCombinedChecked() {
    return COMBINED_CONSENT_KEYS.every((key) => state.consents[key]);
  }

  function setCombinedConsent(val) {
    COMBINED_CONSENT_KEYS.forEach((key) => { state.consents[key] = val; });
  }

  function renderConsentsBlock() {
    const wrap = $("consentsWrap");
    wrap.innerHTML = "";
    const c = CONFIG.consents;

    const selectAllRow = el("div", { className: "consent-row consent-row-select-all" });
    const selectAllCb = el("input", { attrs: { type: "checkbox", id: "consent_select_all" } });
    const selectAllLabel = el("label", { className: "consent-select-all-label", attrs: { for: "consent_select_all" }, text: CONFIG.consentsSelectAllLabel });
    selectAllRow.appendChild(selectAllCb);
    selectAllRow.appendChild(selectAllLabel);
    wrap.appendChild(selectAllRow);

    const rulesRow = buildConsentRow("consent_rules", c.rules, state.consents.rules, (val) => {
      state.consents.rules = val;
      saveState();
      updateSelectAll();
    }, CONFIG.rulesUrl);
    wrap.appendChild(rulesRow);

    const combinedRow = buildConsentRow("consent_combined", c.combined, isCombinedChecked(), (val) => {
      setCombinedConsent(val);
      saveState();
      updateSelectAll();
    }, CONFIG.consentsDocUrl);
    wrap.appendChild(combinedRow);

    function updateSelectAll() {
      selectAllCb.checked = state.consents.rules && isCombinedChecked();
    }

    selectAllCb.addEventListener("change", (e) => {
      const val = e.target.checked;
      state.consents.rules = val;
      setCombinedConsent(val);
      saveState();
      rulesRow.querySelector('input[type="checkbox"]').checked = val;
      combinedRow.querySelector('input[type="checkbox"]').checked = val;
    });

    updateSelectAll();
  }

  function buildConsentRow(id, labelText, checked, onChange, docUrl) {
    const row = el("div", { className: "consent-row" });
    const cb = el("input", { attrs: { type: "checkbox", id: id } });
    cb.checked = !!checked;
    cb.addEventListener("change", (e) => onChange(e.target.checked));
    const label = el("label", { attrs: { for: id } });
    label.appendChild(document.createTextNode(labelText + " — "));
    const link = el("a", { className: "link-btn", text: "Полный текст", attrs: { href: docUrl, target: "_blank", rel: "noopener" } });
    label.appendChild(link);
    row.appendChild(cb);
    row.appendChild(label);
    return row;
  }

  // ---------------------------------------------------------------------
  // Навигация по шагам
  // ---------------------------------------------------------------------
  const STEP_ORDER = ["1", "2", "pub", "4", "consents", "5", "6"];
  let currentStep = "1";

  function showQuizStep(stepKey) {
    document.querySelectorAll(".quiz-step").forEach((node) => {
      node.hidden = node.dataset.step !== stepKey;
    });
    currentStep = stepKey;
    updateProgress(stepKey);
    $("quizSection").scrollIntoView({ behavior: "smooth", block: "start" });
    metrikaGoal("konkurs_step_" + stepKey);
  }

  function updateProgress(stepKey) {
    const idx = STEP_ORDER.indexOf(stepKey);
    const wrap = $("progressWrap");
    if (idx === -1) { wrap.hidden = true; return; }
    wrap.hidden = false;
    $("progressLabel").textContent = `Шаг ${idx + 1} из ${STEP_ORDER.length}`;
    $("progressFill").style.width = ((idx + 1) / STEP_ORDER.length) * 100 + "%";
  }

  function startQuiz() {
    if (Date.now() > new Date(CONFIG.submissionDeadline).getTime()) return;
    $("quizSection").hidden = false;
    metrikaGoal("konkurs_start");
    showQuizStep(currentStep === "1" ? "1" : currentStep);
    // если пользователь уже что-то выбрал ранее (после обновления страницы) — подсветим
    if (state.step1) $("q1NextBtn").disabled = false;
  }

  $("startBtn").addEventListener("click", startQuiz);
  $("startBtn2").addEventListener("click", startQuiz);

  // Клик по карточке номинации на главной — сразу выбирает её темой истории
  // и переносит к началу анкеты (шаг 1 всё равно нужно пройти, а на шаге
  // "Номинация" эта карточка уже будет выбрана — останется нажать «Далее»).
  function startQuizWithTopic(topicId) {
    state.topic = topicId;
    saveState();
    refreshOptionSelection("q2Options", (idx) => CONFIG.topics[idx].id === topicId);
    $("q2NextBtn").disabled = false;
    startQuiz();
  }

  document.querySelectorAll('[data-nav="back"]').forEach((btn) => {
    btn.addEventListener("click", () => {
      const idx = STEP_ORDER.indexOf(currentStep);
      if (idx > 0) showQuizStep(STEP_ORDER[idx - 1]);
    });
  });

  document.querySelectorAll('[data-nav="restart"]').forEach((btn) => {
    btn.addEventListener("click", () => showQuizStep("1"));
  });

  $("q1NextBtn").addEventListener("click", () => {
    if (!state.step1) return;
    showQuizStep("2");
  });

  $("q2NextBtn").addEventListener("click", () => {
    if (!state.topic) return;
    showQuizStep("pub");
  });

  $("pubNextBtn").addEventListener("click", () => {
    const errors = [];
    if (!state.contacts.name.trim()) errors.push("Укажите ФИО");
    if (!state.contacts.city.trim()) errors.push("Укажите город");

    const errEl = $("pubError");
    if (errors.length) {
      errEl.textContent = errors.join(" · ");
      errEl.hidden = false;
      return;
    }
    errEl.hidden = true;
    saveState();
    renderHints();
    showQuizStep("4");
  });

  function renderHints() {
    const topic = CONFIG.topics.find((t) => t.id === state.topic);
    const hintsList = $("hintsList");
    hintsList.innerHTML = "";
    (topic ? topic.hints : []).forEach((h) => hintsList.appendChild(el("li", { text: h })));
  }

  $("videoReadyBtn").addEventListener("click", () => showQuizStep("consents"));

  $("consentsNextBtn").addEventListener("click", () => {
    const errors = validateConsents();
    const errEl = $("consentsError");
    if (errors.length) {
      errEl.textContent = errors.join(" · ");
      errEl.hidden = false;
      return;
    }
    errEl.hidden = true;
    saveState();
    showQuizStep("5");
  });

  $("filmLaterBtn").addEventListener("click", () => {
    showQuizStep("later");
    metrikaGoal("konkurs_later");
  });

  $("toStep6Btn").addEventListener("click", () => {
    if (!videoFile) return;
    showQuizStep("6");
  });

  $("submitBtn").addEventListener("click", handleSubmit);

  // ---------------------------------------------------------------------
  // Загрузка и валидация видео
  // ---------------------------------------------------------------------
  const dropzone = $("dropzone");
  const fileInput = $("fileInput");

  dropzone.addEventListener("click", () => fileInput.click());
  dropzone.addEventListener("dragover", (e) => { e.preventDefault(); dropzone.classList.add("dragover"); });
  dropzone.addEventListener("dragleave", () => dropzone.classList.remove("dragover"));
  dropzone.addEventListener("drop", (e) => {
    e.preventDefault();
    dropzone.classList.remove("dragover");
    if (e.dataTransfer.files && e.dataTransfer.files[0]) handleFileSelected(e.dataTransfer.files[0]);
  });
  fileInput.addEventListener("change", (e) => {
    if (e.target.files && e.target.files[0]) handleFileSelected(e.target.files[0]);
  });
  $("replaceFileBtn").addEventListener("click", (e) => {
    e.stopPropagation();
    resetUpload();
    fileInput.click();
  });

  function resetUpload() {
    if (currentUploadXhr) {
      currentUploadXhr.abort();
      currentUploadXhr = null;
    }
    videoFile = null;
    state.videoMeta = null;
    state.videoViewUrl = "";
    state.videoObjectKey = "";
    saveState();
    $("filePreview").hidden = true;
    $("uploadProgress").hidden = true;
    $("uploadError").hidden = true;
    $("uploadWarning").hidden = true;
    $("toStep6Btn").disabled = true;
    fileInput.value = "";
  }

  function showUploadError(text) {
    const errEl = $("uploadError");
    errEl.textContent = text;
    errEl.hidden = false;
  }

  function handleFileSelected(file) {
    $("uploadError").hidden = true;
    $("uploadWarning").hidden = true;

    // MP4/MOV — то, что просим при обычной загрузке файла; webm сюда же добавлен
    // ради видео, записанных прямо в браузере кнопкой «Снять видео сейчас» — на
    // Android/Chrome браузер умеет записывать только в этом формате, не в MP4.
    const allowedTypes = ["video/mp4", "video/quicktime", "video/webm"];
    const isAllowedExt = /\.(mp4|mov|webm)$/i.test(file.name);
    if (!allowedTypes.includes(file.type) && !isAllowedExt) {
      showUploadError("Такой формат не подходит. Нужен MP4 или MOV");
      return;
    }

    if (file.size > CONFIG.uploadMaxSizeMb * 1024 * 1024) {
      showUploadError("Файл больше 200 МБ. Снимите покороче или в более низком качестве");
      return;
    }

    const objectUrl = URL.createObjectURL(file);
    const probe = document.createElement("video");
    probe.preload = "metadata";
    probe.src = objectUrl;

    probe.onloadedmetadata = () => {
      const duration = probe.duration;
      const width = probe.videoWidth;
      const height = probe.videoHeight;

      if (duration < CONFIG.uploadMinDurationSec) {
        showUploadError("Ролик короче 30 секунд. Расскажите чуть подробнее");
        URL.revokeObjectURL(objectUrl);
        return;
      }
      if (duration > CONFIG.uploadMaxDurationSec) {
        showUploadError("Ролик длиннее 2 минут. Нужно уложиться в два");
        URL.revokeObjectURL(objectUrl);
        return;
      }

      videoFile = file;
      state.videoMeta = { name: file.name, size: file.size, duration, width, height };
      saveState();

      if (width > height) {
        $("uploadWarning").hidden = false;
        $("uploadWarning").textContent = "Видео горизонтальное. По правилам нужно вертикальное, можно заменить";
      }

      uploadToStorage(file, () => {
        $("previewVideo").src = objectUrl;
        $("fileNameText").textContent = file.name;
        $("fileMetaText").textContent = `${formatDuration(duration)} · ${formatBytes(file.size)}`;
        $("filePreview").hidden = false;
        $("toStep6Btn").disabled = false;
        metrikaGoal("konkurs_video_uploaded");
      });
    };

    probe.onerror = () => {
      showUploadError("Не удалось прочитать файл. Попробуйте другое видео");
      URL.revokeObjectURL(objectUrl);
    };
  }

  // Реальная загрузка файла напрямую в VK Object Storage:
  // 1) просим сервер (/api/get-upload-url) выдать одноразовую защищённую ссылку;
  // 2) заливаем файл по этой ссылке напрямую в бакет, с прогрессом;
  // 3) сохраняем защищённую ссылку на просмотр — она уйдёт в письмо на почту.
  function uploadToStorage(file, onDone) {
    const progressWrap = $("uploadProgress");
    const fill = $("uploadProgressFill");
    const text = $("uploadProgressText");
    progressWrap.hidden = false;
    fill.style.width = "0%";
    text.textContent = "Подготовка загрузки…";

    const contentType = file.type || "video/mp4";

    fetch("/api/get-upload-url", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        filename: file.name,
        contentType,
        fio: state.contacts.name || "",
        // Если номер уже выдавался раньше (например, человек заменяет видео) — передаём
        // тот же самый, чтобы файл в хранилище не задваивался под новым именем
        applicationNumber: state.applicationNumber || ""
      })
    })
      .then((res) => {
        if (!res.ok) throw new Error("presign_failed");
        return res.json();
      })
      .then(({ uploadUrl, viewUrl, objectKey, applicationNumber }) => {
        const xhr = new XMLHttpRequest();
        currentUploadXhr = xhr;
        xhr.open("PUT", uploadUrl);
        xhr.setRequestHeader("Content-Type", contentType);

        xhr.upload.onprogress = (e) => {
          if (!e.lengthComputable) return;
          const pct = Math.round((e.loaded / e.total) * 100);
          fill.style.width = pct + "%";
          text.textContent = `Загрузка… ${pct}%`;
        };

        xhr.onload = () => {
          currentUploadXhr = null;
          progressWrap.hidden = true;
          if (xhr.status >= 200 && xhr.status < 300) {
            state.videoViewUrl = viewUrl;
            state.videoObjectKey = objectKey;
            // Номер присваивается один раз: если человек заменит видео и получит новую
            // ссылку на загрузку, номер заявки не должен поменяться на новый.
            state.applicationNumber = state.applicationNumber || applicationNumber;
            saveState();
            onDone();
          } else {
            showUploadError("Не получилось загрузить видео на сервер. Нажмите «Заменить» и попробуйте ещё раз");
          }
        };

        xhr.onerror = () => {
          currentUploadXhr = null;
          progressWrap.hidden = true;
          showUploadError("Загрузка прервалась. Проверьте интернет, нажмите «Заменить» и попробуйте снова");
        };

        xhr.send(file);
      })
      .catch(() => {
        currentUploadXhr = null;
        progressWrap.hidden = true;
        showUploadError("Не получилось начать загрузку. Проверьте интернет и попробуйте ещё раз");
      });
  }

  // ---------------------------------------------------------------------
  // Съёмка видео прямо с камеры устройства («Снять видео сейчас»)
  // ---------------------------------------------------------------------
  // Никакого своего окна поверх сайта: кнопка открывает штатную камеру
  // телефона через input[capture] — вертикальную съёмку, выбор фронтальной/
  // основной камеры и разрешение на использование камеры даёт сама ОС.
  // Выбранный ролик попадает в тот же пайплайн проверки и загрузки, что и
  // обычный файл из медиатеки (handleFileSelected).
  function initRecorderButton() {
    $("recordNowBtn").hidden = false;
    $("uploadDivider").hidden = false;
  }

  const cameraCaptureInput = $("cameraCaptureInput");
  $("recordNowBtn").addEventListener("click", () => cameraCaptureInput.click());
  cameraCaptureInput.addEventListener("change", (e) => {
    if (e.target.files && e.target.files[0]) handleFileSelected(e.target.files[0]);
    cameraCaptureInput.value = "";
  });

  // Обрыв связи во время загрузки — прерываем запрос и сообщаем об этом
  window.addEventListener("offline", () => {
    if (currentUploadXhr) {
      currentUploadXhr.abort();
      currentUploadXhr = null;
    }
    if (!$("uploadProgress").hidden) {
      showUploadError('Загрузка прервалась. Проверьте интернет и нажмите «Заменить», чтобы попробовать снова');
      $("uploadProgress").hidden = true;
    }
  });

  // ---------------------------------------------------------------------
  // Отправка заявки
  // ---------------------------------------------------------------------
  function renderChannelSelectionInit() { renderChannelSelection(); }

  // Обычно номер уже присвоен сервером при загрузке видео (см. /api/get-upload-url).
  // Этот генератор — только подстраховка на случай, если тот запрос почему-то
  // не вернул номер: старый счётчик в localStorage удалён, потому что он считал
  // независимо в каждом браузере и номера повторялись у разных участников.
  function fallbackApplicationNumber() {
    return "К-" + Date.now().toString(36).toUpperCase() + "-" + Math.random().toString(36).slice(2, 5).toUpperCase();
  }

  // Проверка отдельного шага "Согласия" (перед загрузкой видео)
  function validateConsents() {
    const errors = [];
    if (!state.consents.rules) errors.push("Нужно согласие с правилами конкурса");
    if (!state.consents.pdn) errors.push("Нужно согласие на обработку персональных данных");
    if (!state.consents.pdnDistribution) errors.push("Нужно согласие на обработку персональных данных, разрешённых для распространения");
    if (!state.consents.image) errors.push("Нужно согласие на использование изображения");
    if (!state.consents.license) errors.push("Нужно согласие на использование видео, голоса и текста отзыва");
    return errors;
  }

  function validateStep6() {
    const errors = [];
    if (!state.contacts.phone.trim()) errors.push("Укажите телефон");
    if (!state.contacts.channel) errors.push("Выберите удобный канал связи");
    if (!state.videoViewUrl) errors.push("Видео не загрузилось на сервер — вернитесь на шаг загрузки и попробуйте ещё раз");

    // На случай, если шаг "Согласия" был пропущен (например, при восстановлении черновика)
    errors.push(...validateConsents());

    // Honeypot: если заполнено — вероятно, бот
    if ($("hp_website").value.trim() !== "") {
      errors.push("__bot__");
    }

    return errors;
  }

  async function handleSubmit() {
    const errors = validateStep6();
    const errEl = $("formError");

    if (errors.includes("__bot__")) {
      // Тихо отклоняем без объяснений — это ловушка для ботов, не для людей
      return;
    }

    if (errors.length) {
      errEl.textContent = errors.join(" · ");
      errEl.hidden = false;
      return;
    }
    errEl.hidden = true;

    const appNumber = state.applicationNumber || fallbackApplicationNumber();
    state.applicationNumber = appNumber;
    state.utm = getUtmFromUrl();

    const submitBtn = $("submitBtn");
    submitBtn.disabled = true;
    const submitBtnOriginalText = submitBtn.textContent;
    submitBtn.textContent = "Отправляем…";

    const sent = await submitToBackend(buildEmailFields(appNumber));

    submitBtn.disabled = false;
    submitBtn.textContent = submitBtnOriginalText;

    if (!sent) {
      errEl.textContent = "Не получилось отправить заявку. Проверьте интернет и нажмите «Отправить» ещё раз — или позвоните по " + CONFIG.organizerPhone;
      errEl.hidden = false;
      return;
    }

    saveState();
    $("applicationNumber").textContent = appNumber;
    if (state.contacts.name) {
      $("finalFio").textContent = (CONFIG.finalFioLabel ? CONFIG.finalFioLabel + ": " : "") + state.contacts.name;
      $("finalFio").hidden = false;
    }
    $("finalText").textContent = CONFIG.finalText.replace("{results}", CONFIG.resultsDate);
    showQuizStep("final");
    metrikaGoal("konkurs_submit");

    // После успешной отправки прогресс анкеты в этой вкладке больше не нужен
    try { sessionStorage.removeItem(STORAGE_KEY); } catch (e) { /* noop */ }
  }

  // Собирает данные анкеты и ссылку на видео в плоский набор полей для письма на почту.
  function buildEmailFields(appNumber) {
    const stazhLabel = (CONFIG.step1Options.find((o) => o.id === state.step1) || {}).label || "—";
    const topicLabel = (CONFIG.topics.find((t) => t.id === state.topic) || {}).label || state.topic || "—";
    const consentsSummary = Object.entries(state.consents)
      .map(([key, val]) => key + ": " + (val ? "да" : "нет"))
      .join("; ");
    const videoLocalInfo = state.videoMeta
      ? state.videoMeta.name + ", " + (state.videoMeta.size / (1024 * 1024)).toFixed(1) + " МБ, " + Math.round(state.videoMeta.duration) + " сек"
      : "не выбрано на сайте";

    return {
      _subject: "Заявка " + appNumber + " — конкурс видеоотзывов ПРАВЭКС",
      _template: "table",
      _captcha: "false",
      _replyto: state.contacts.email || "",
      "Номер заявки": appNumber,
      "Дата и время (МСК)": nowMsk(),
      "ФИО": state.contacts.name,
      "Телефон": state.contacts.phone,
      "E-mail": state.contacts.email || "—",
      "Город": state.contacts.city,
      "Удобный канал связи": state.contacts.channel || "—",
      "Стаж партнёрства": stazhLabel,
      "Тема истории": topicLabel,
      "Ссылка на видео (активна 6 дней)": state.videoViewUrl || "— (загрузка не завершилась, файл нужно запросить у участника отдельно)",
      "Путь к файлу в хранилище": state.videoObjectKey || "—",
      "Видео, выбранное на сайте": videoLocalInfo,
      ["Согласия (версия " + CONFIG.consents.version + ")"]: consentsSummary,
      "UTM-метки": Object.keys(state.utm || {}).length ? JSON.stringify(state.utm) : "—",
      "Повторная отправка": isDuplicateSubmission ? "да" : "нет"
    };
  }

  // Заявка уходит на наш же сервер (/api/submit-application), а он уже сам
  // отправляет письмо по SMTP через VK WorkMail (см. подробности в этом файле).
  function submitToBackend(fields) {
    return fetch("/api/submit-application", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(fields)
    })
      .then((res) => res.json().catch(() => null))
      .then((data) => !!(data && data.success))
      .catch((err) => {
        console.error("Ошибка отправки заявки:", err);
        return false;
      });
  }

  $("shareBtn").addEventListener("click", () => {
    const url = new URL(window.location.href);
    url.search = "";
    url.searchParams.set("utm_source", "share");
    url.searchParams.set("utm_medium", "referral");
    url.searchParams.set("utm_campaign", CONFIG.utmCampaign);
    const shareUrl = url.toString();

    if (navigator.share) {
      navigator.share({ title: CONFIG.heroTitle, url: shareUrl }).catch(() => {});
    } else if (navigator.clipboard) {
      navigator.clipboard.writeText(shareUrl).then(() => {
        alert("Ссылка скопирована: " + shareUrl);
      }).catch(() => {
        prompt("Скопируйте ссылку:", shareUrl);
      });
    } else {
      prompt("Скопируйте ссылку:", shareUrl);
    }
  });

  // ---------------------------------------------------------------------
  // Cookie-баннер / прочее
  // ---------------------------------------------------------------------
  $("rulesLinkBtn").addEventListener("click", () => {
    window.open(CONFIG.rulesUrl, "_blank", "noopener");
  });

  function initCookieBanner() {
    if (localStorage.getItem("pravexCookieAccepted") === "1") return;
    $("cookieBanner").hidden = false;
    $("cookieAcceptBtn").addEventListener("click", () => {
      localStorage.setItem("pravexCookieAccepted", "1");
      $("cookieBanner").hidden = true;
    });
  }

  // ---------------------------------------------------------------------
  // Инициализация
  // ---------------------------------------------------------------------
  function init() {
    // Ответ на первый вопрос из старого черновика («Да/Нет») больше не подходит
    if (state.step1 && !CONFIG.step1Options.some((o) => o.id === state.step1)) { state.step1 = null; saveState(); }
    renderStatic();
    renderQuizStatic();
    renderChannelSelectionInit();
    initCookieBanner();
    initRecorderButton();

    // Автосохранение UTM из ссылки при заходе
    const utm = getUtmFromUrl();
    if (Object.keys(utm).length) {
      state.utm = utm;
      saveState();
    }

    if (state.step1) {
      $("q1NextBtn").disabled = false;
      renderHints();
    }
    if (state.topic) $("q2NextBtn").disabled = false;
  }

  document.addEventListener("DOMContentLoaded", init);
})();
