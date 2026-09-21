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
    format: null,
    videoMeta: null, // {name, size, duration, width, height} — сам файл не сохраняется в localStorage
    caseNumber: "",
    debtAmount: "",
    contacts: { name: "", phone: "", email: "", city: "", channel: null },
    consents: {
      rules: false,
      pdn: false,
      pdnDistribution: false,
      image: false,
      license: false,
      distribution: { face: false, name: false, city: false, case_number: false, debt_amount: false }
    },
    utm: {},
    applicationNumber: null
  };

  let state = loadState();
  let videoFile = null; // File — живёт только в памяти вкладки
  let isDuplicateSubmission = false;

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
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
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
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
    $("startBtn").textContent = CONFIG.heroCtaLabel;
    $("startBtn2").textContent = CONFIG.heroCtaLabel;
    $("rulesLinkBtn").textContent = CONFIG.heroRulesLabel;

    const badgesWrap = $("heroBadges");
    badgesWrap.innerHTML = "";
    CONFIG.heroBadges.forEach((b) => {
      const badge = el("div", { className: "hero-badge" });
      badge.appendChild(el("span", { className: "badge-label", text: b.label }));
      badge.appendChild(el("span", { className: "badge-value", text: b.value }));
      badgesWrap.appendChild(badge);
    });

    const disclaimer = CONFIG.adDisclaimerTemplate
      .replace("{start}", formatDateRu(CONFIG.contestStartDate))
      .replace("{end}", formatDateRu(CONFIG.contestEndDate))
      .replace("{deadline}", formatDateTimeRu(CONFIG.submissionDeadline))
      .replace("{organizer}", CONFIG.organizerName)
      .replace("{prizes}", CONFIG.prizesDisclaimerText)
      .replace("{rulesLink}", CONFIG.rulesUrl);
    $("adDisclaimer").textContent = disclaimer.replace(/\.\.(?!\.)/g, "."); // "г.." после даты → "г."

    // Как участвовать
    const howGrid = $("howGrid");
    howGrid.innerHTML = "";
    CONFIG.howItWorks.forEach((step, i) => {
      const card = el("div", { className: "step-card" });
      card.appendChild(el("span", { className: "step-num", text: String(i + 1) }));
      card.appendChild(el("h3", { text: step.title }));
      card.appendChild(el("p", { text: step.text }));
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
      details.appendChild(el("div", { className: "faq-answer", text: item.a }));
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
    $("cookiePrivacyLink").href = CONFIG.privacyUrl;

    // Демо-баннер
    $("demoBanner").hidden = !!CONFIG.submitEndpoint;

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

    $("notClientTitle").textContent = CONFIG.notClientTitle;
    $("notClientText").textContent = CONFIG.notClientText;
    $("notClientPhone").textContent = CONFIG.organizerPhone;
    $("notClientPhone").href = CONFIG.organizerPhoneHref;

    // Шаг 2
    $("q2Question").textContent = CONFIG.step2Question;
    const q2Wrap = $("q2Options");
    q2Wrap.innerHTML = "";
    CONFIG.topics.forEach((t) => {
      q2Wrap.appendChild(buildOptionCard(t.label, ICONS[t.icon], () => selectTopic(t.id), () => state.topic === t.id));
    });

    // Шаг 3
    $("q3Question").textContent = CONFIG.step3Question;
    $("q3Note").textContent = CONFIG.step3Note;
    const q3Wrap = $("q3Options");
    q3Wrap.innerHTML = "";
    CONFIG.formats.forEach((f) => {
      q3Wrap.appendChild(buildOptionCard(f.label, null, () => selectFormat(f.id), () => state.format === f.id, f.desc));
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
    $("pCaseNumber").value = state.caseNumber || "";
    $("pCity").value = state.contacts.city || "";
    $("pDebt").value = state.debtAmount || "";
    $("pFio").addEventListener("input", (e) => { state.contacts.name = e.target.value; saveState(); });
    $("pCaseNumber").addEventListener("input", (e) => { state.caseNumber = e.target.value; saveState(); });
    $("pCity").addEventListener("input", (e) => { state.contacts.city = e.target.value; saveState(); });
    $("pDebt").addEventListener("input", (e) => { state.debtAmount = e.target.value; saveState(); });
    updatePubNote();
  }

  function updatePubNote() {
    const isOpen = state.format === "open";
    $("pubNote").textContent = isOpen ? CONFIG.pubNoteOpen : CONFIG.pubNoteNameOnly;
    $("pDebtField").hidden = !isOpen;
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

  function selectFormat(id) {
    state.format = id;
    saveState();
    refreshOptionSelection("q3Options", (idx) => CONFIG.formats[idx].id === id);
    $("q3NextBtn").disabled = false;
    prefillDistributionFromFormat(id);
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

  function prefillDistributionFromFormat(formatId) {
    const d = state.consents.distribution;
    if (formatId === "open") {
      d.face = true; d.name = true; d.city = true; d.case_number = true; d.debt_amount = true;
    } else if (formatId === "name_only") {
      d.face = true; d.name = true; d.city = false; d.case_number = true; d.debt_amount = false;
    }
    saveState();
    renderConsentsBlock();
  }

  function renderConsentsBlock() {
    const wrap = $("consentsWrap");
    wrap.innerHTML = "";
    const c = CONFIG.consents;

    const consent = (key, text, modalTitle, modalBody) => wrap.appendChild(buildConsentRow(
      "consent_" + key, text, state.consents[key],
      (val) => { state.consents[key] = val; saveState(); },
      () => openRulesModal(modalTitle, modalBody)
    ));

    // 0 — правила конкурса
    wrap.appendChild(buildConsentRow("consent_rules", c.rules, state.consents.rules,
      (val) => { state.consents.rules = val; saveState(); },
      () => window.open(CONFIG.rulesUrl, "_blank", "noopener")));

    // 1 — обработка ПДн
    consent("pdn", c.pdn, "Согласие на обработку персональных данных", "Здесь размещается полный текст согласия на обработку персональных данных (152-ФЗ, п. 10.1.1 правил).");

    // 2 — ПДн, разрешённые для распространения, с выбором формата
    consent("pdnDistribution", c.pdnDistribution, "Согласие на обработку персональных данных, разрешённых для распространения", "Здесь размещается полный текст отдельного согласия на обработку персональных данных, разрешённых субъектом для распространения (ст. 10.1 152-ФЗ), с указанием выбранного формата: «Открытый» или «Полуоткрытый».");
    const formatBox = el("div", { className: "consent-formats" });
    CONFIG.formats.forEach((f) => {
      const label = el("label", { className: "consent-format" });
      const radio = el("input", { attrs: { type: "radio", name: "consent_format", value: f.id } });
      radio.checked = state.format === f.id;
      radio.addEventListener("change", () => {
        state.format = f.id;
        refreshOptionSelection("q3Options", (idx) => CONFIG.formats[idx].id === f.id);
        $("q3NextBtn").disabled = false;
        prefillDistributionFromFormat(f.id);
      });
      label.appendChild(radio);
      label.appendChild(document.createTextNode(" " + f.consentLabel + " — " + f.desc));
      formatBox.appendChild(label);
    });
    wrap.appendChild(formatBox);

    // 3 — использование изображения
    consent("image", c.image, "Согласие на использование изображения", "Здесь размещается полный текст согласия на обнародование и использование изображения (ст. 152.1 ГК РФ, п. 10.1.3 правил).");

    // 4 — права ПРАВЭКС на видео, голос и текст отзыва
    consent("license", c.license, "Документ о правах на использование отзыва", "Здесь размещается полный текст документа о правах ПРАВЭКС на использование видео, голоса и текста отзыва, включая монтаж и рекламное использование (раздел 11 правил).");
  }

  function buildConsentRow(id, labelText, checked, onChange, onOpenFull) {
    const row = el("div", { className: "consent-row" });
    const cb = el("input", { attrs: { type: "checkbox", id: id } });
    cb.checked = !!checked;
    cb.addEventListener("change", (e) => onChange(e.target.checked));
    const label = el("label", { attrs: { for: id } });
    label.appendChild(document.createTextNode(labelText + " — "));
    const link = el("button", { className: "link-btn", text: "Полный текст", attrs: { type: "button" } });
    link.addEventListener("click", (e) => { e.preventDefault(); onOpenFull(); });
    label.appendChild(link);
    row.appendChild(cb);
    row.appendChild(label);
    return row;
  }

  function openRulesModal(title, bodyText) {
    $("modalContent").innerHTML = `<h2>${title}</h2><p>${bodyText}</p><p style="color:var(--color-text-muted); font-size:13px;">Версия текста: ${CONFIG.consents.version}</p>`;
    $("modalOverlay").hidden = false;
  }

  // ---------------------------------------------------------------------
  // Навигация по шагам
  // ---------------------------------------------------------------------
  const STEP_ORDER = ["1", "2", "3", "pub", "4", "consents", "5", "6"];
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
    if (state.step1 === "no") {
      showQuizStep("not-client");
      metrikaGoal("konkurs_not_client");
    } else {
      showQuizStep("2");
    }
  });

  $("q2NextBtn").addEventListener("click", () => {
    if (!state.topic) return;
    renderHints();
    showQuizStep("3");
  });

  $("q3NextBtn").addEventListener("click", () => {
    if (!state.format) return;
    updatePubNote();
    showQuizStep("pub");
  });

  $("pubNextBtn").addEventListener("click", () => {
    const errors = [];
    if (!state.contacts.name.trim()) errors.push("Укажите ФИО");
    if (!state.caseNumber.trim()) errors.push("Укажите номер дела");
    if (!state.contacts.city.trim()) errors.push("Укажите город");
    if (state.format === "open" && !state.debtAmount.trim()) errors.push("Укажите сумму долга");

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
    videoFile = null;
    state.videoMeta = null;
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

    const allowedTypes = ["video/mp4", "video/quicktime"];
    const isAllowedExt = /\.(mp4|mov)$/i.test(file.name);
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
        showUploadError("Ролик короче 1 минуты. Расскажите чуть подробнее");
        URL.revokeObjectURL(objectUrl);
        return;
      }
      if (duration > CONFIG.uploadMaxDurationSec) {
        showUploadError("Ролик длиннее 3 минут. Нужно уложиться в три");
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

      simulateUpload(() => {
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

  function simulateUpload(onDone) {
    // Здесь эмулируется прогресс отправки файла в хранилище.
    // В боевой версии вместо этого — реальный fetch/XHR с прогрессом
    // на CONFIG.submitEndpoint (или на прямой upload-URL хранилища).
    const progressWrap = $("uploadProgress");
    const fill = $("uploadProgressFill");
    const text = $("uploadProgressText");
    progressWrap.hidden = false;
    fill.style.width = "0%";
    let pct = 0;
    const timer = setInterval(() => {
      pct = Math.min(100, pct + Math.random() * 25 + 10);
      fill.style.width = pct + "%";
      text.textContent = `Загрузка… ${Math.round(pct)}%`;
      if (pct >= 100) {
        clearInterval(timer);
        progressWrap.hidden = true;
        onDone();
      }
    }, 250);
  }

  // Обрыв связи — демонстрация обработки ошибки при потере сети во время "загрузки"
  window.addEventListener("offline", () => {
    if (!$("uploadProgress").hidden) {
      showUploadError('Загрузка прервалась. Проверьте интернет и нажмите «Повторить»');
      $("uploadProgress").hidden = true;
    }
  });

  // ---------------------------------------------------------------------
  // Отправка заявки
  // ---------------------------------------------------------------------
  function renderChannelSelectionInit() { renderChannelSelection(); }

  function generateApplicationNumber() {
    let counter = Number(localStorage.getItem("pravexKonkursCounter") || "0") + 1;
    localStorage.setItem("pravexKonkursCounter", String(counter));
    return "К-" + String(counter).padStart(4, "0");
  }

  // Проверка отдельного шага "Согласия" (перед загрузкой видео)
  function validateConsents() {
    const errors = [];
    if (!state.consents.rules) errors.push("Нужно согласие с правилами конкурса");
    if (!state.consents.pdn) errors.push("Нужно согласие на обработку персональных данных");
    if (!state.consents.pdnDistribution) errors.push("Нужно согласие на обработку персональных данных, разрешённых для распространения");
    if (!state.format) errors.push("Выберите формат публикации: «Открытый» или «Полуоткрытый»");
    if (!state.consents.image) errors.push("Нужно согласие на использование изображения");
    if (!state.consents.license) errors.push("Нужно согласие на использование видео, голоса и текста отзыва");
    return errors;
  }

  function validateStep6() {
    const errors = [];
    if (!state.contacts.phone.trim()) errors.push("Укажите телефон");
    if (!state.contacts.channel) errors.push("Выберите удобный канал связи");

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

    const appNumber = state.applicationNumber || generateApplicationNumber();
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
    $("finalText").textContent = CONFIG.finalText.replace("{results}", CONFIG.resultsDate);
    showQuizStep("final");
    metrikaGoal("konkurs_submit");

    // После успешной отправки прогресс анкеты в этой вкладке больше не нужен
    localStorage.removeItem(STORAGE_KEY);
  }

  // Собирает данные анкеты и ссылку на видео в плоский набор полей для письма на почту.
  function buildEmailFields(appNumber) {
    const topicLabel = (CONFIG.topics.find((t) => t.id === state.topic) || {}).label || state.topic || "—";
    const formatObj = CONFIG.formats.find((f) => f.id === state.format) || {};
    const formatLabel = formatObj.consentLabel ? formatObj.consentLabel + " — " + formatObj.desc : (state.format || "—");
    const consentsSummary = Object.entries(state.consents)
      .filter(([key]) => key !== "distribution")
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
      "Тема истории": topicLabel,
      "Формат публикации": formatLabel,
      "Номер дела": state.caseNumber,
      "Сумма долга": state.format === "open" ? (state.debtAmount || "не указана") : "не указывается (формат «Полуоткрыто»)",
      "Видео, выбранное на сайте": videoLocalInfo + " — файл нужно запросить у участника отдельно, сайт его пока не загружает",
      ["Согласия (версия " + CONFIG.consents.version + ")"]: consentsSummary,
      "UTM-метки": Object.keys(state.utm || {}).length ? JSON.stringify(state.utm) : "—",
      "Повторная отправка": isDuplicateSubmission ? "да" : "нет"
    };
  }

  // Отправляет данные заявки на почту через FormSubmit — без своего сервера.
  // При первой заявке владельцу marketing@pravex24.ru придёт письмо со ссылкой
  // для подтверждения приёма форм с этого сайта — его нужно один раз открыть.
  function submitToBackend(fields) {
    if (!CONFIG.submitEndpoint) {
      // ДЕМО-РЕЖИМ: submitEndpoint не настроен — заявки никуда не уходят.
      console.warn("[demo] Заявка НЕ отправлена — submitEndpoint не настроен.", fields);
      return Promise.resolve(true);
    }

    return fetch(CONFIG.submitEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": "application/json" },
      body: JSON.stringify(fields)
    })
      .then((res) => res.ok)
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
  // Модалка правил / cookie-баннер / прочее
  // ---------------------------------------------------------------------
  $("rulesLinkBtn").addEventListener("click", () => {
    window.open(CONFIG.rulesUrl, "_blank", "noopener");
  });

  $("modalClose").addEventListener("click", () => { $("modalOverlay").hidden = true; });
  $("modalOverlay").addEventListener("click", (e) => {
    if (e.target === $("modalOverlay")) $("modalOverlay").hidden = true;
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
    renderStatic();
    renderQuizStatic();
    renderChannelSelectionInit();
    initCookieBanner();

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
    if (state.format) $("q3NextBtn").disabled = false;
  }

  document.addEventListener("DOMContentLoaded", init);
})();
