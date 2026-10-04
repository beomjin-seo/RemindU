/* Storyge V3. Static, local-first prototype; no account or AI network calls. */
(async () => {
  "use strict";
  const $ = (id) => document.getElementById(id),
    store = window.StoryStore;
  const esc = (value) =>
    String(value ?? "").replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c],
    );
  const icon = (name) => `<i data-lucide="${name}"></i>`;
  const icons = () =>
    window.lucide?.createIcons({
      attrs: { "aria-hidden": "true", "stroke-width": 1.6 },
    });
  const reduce = matchMedia("(prefers-reduced-motion: reduce)");
  const tabs = [
    ["feed", "나의 피드", "orbit"],
    ["library", "보관함", "layers-2"],
    ["folders", "폴더", "folder-closed"],
    ["search", "검색", "search"],
  ];
  const state = {
    view: "feed",
    folder: "",
    platform: "전체",
    favorite: false,
    query: "",
    sort: "new",
    layout: "grid",
    feed: "orbit",
  };
  let orbit = null,
    modal = null,
    toastTimer,
    keyboard = false,
    navAnimation = null;
  document.addEventListener("pointerdown", () => (keyboard = false), true);
  document.addEventListener("keydown", () => (keyboard = true), true);
  const safeURL = (value) => {
    try {
      const u = new URL(value);
      return ["http:", "https:"].includes(u.protocol) ? u.href : "";
    } catch {
      return "";
    }
  };
  const date = (value) =>
    new Date(value).toLocaleDateString("ko-KR", {
      month: "short",
      day: "numeric",
    });
  const host = (value) => {
    try {
      return new URL(value).hostname.replace(/^www\./, "");
    } catch {
      return "이미지 파일";
    }
  };
  function thumb(item, className = "") {
    return item.image
      ? `<img class="${className}" src="${esc(item.image)}" alt="" loading="lazy">`
      : `<div class="card-placeholder ${className}">${icon("link")}<span>${esc(host(item.url))}</span></div>`;
  }
  function imageFallback(root = document) {
    root.querySelectorAll("img").forEach((img) => {
      if (img.closest(".orbit-item")) return;
      img.onerror = () => {
        const fallback = document.createElement("div");
        fallback.className = "card-placeholder";
        fallback.innerHTML = icon("image-off") + "<span>미리보기 없음</span>";
        img.replaceWith(fallback);
        icons();
      };
    });
  }
  function storageStatus() {
    $("storage-label").textContent =
      store.storageMode === "persistent"
        ? "이 브라우저에 저장"
        : "임시 저장 모드";
  }
  function notify(message, action) {
    clearTimeout(toastTimer);
    const el = $("toast");
    el.replaceChildren();
    const text = document.createElement("span");
    text.textContent = message;
    el.append(text);
    if (action) {
      const button = document.createElement("button");
      button.textContent = action.label;
      button.onclick = async () => {
        if (button.disabled) return;
        const returnToContent = el.contains(document.activeElement);
        button.disabled = true;
        try {
          await action.run();
          el.hidden = true;
          if (returnToContent) $("page-title")?.focus({ preventScroll: true });
        } catch (e) {
          notify(e.message);
        }
      };
      el.append(button);
    }
    el.hidden = false;
    toastTimer = setTimeout(
      () => {
        if (el.contains(document.activeElement)) return;
        el.hidden = true;
      },
      action ? 10000 : 4500,
    );
  }
  async function mutate(fn) {
    const result = await fn();
    storageStatus();
    if (store.storageMode === "memory")
      notify("임시 저장 모드입니다. 새로고침 전에 내보내기를 해주세요.");
    return result;
  }
  function focusKey(node = document.activeElement) {
    if (!node || !$("app").contains(node)) return null;
    if (node.id) return { id: node.id };
    for (const key of [
      "nav",
      "folder",
      "item",
      "favorite",
      "platform",
      "query",
      "feedMode",
      "action",
    ]) {
      if (node.dataset?.[key] !== undefined)
        return {
          key,
          value: node.dataset[key],
          scope: node.closest("[id]")?.id,
        };
    }
    return null;
  }
  function restoreFocus(key, fallback = true) {
    if (modal) return;
    let target = key?.id ? $(key.id) : null;
    if (key?.key) {
      const root = $(key.scope) || $("app");
      target = [...root.querySelectorAll("button")].find(
        (b) => b.dataset[key.key] === key.value && b.getClientRects().length,
      );
    }
    if (!target?.getClientRects().length || target.disabled)
      target = fallback ? $("page-title") : null;
    target?.focus({ preventScroll: true });
  }
  function setModalBusy(layer, busy) {
    const m = modal;
    if (!m || m.layer !== layer || m.closing || (busy && m.busy)) return false;
    m.busy = busy;
    m.panel.setAttribute("aria-busy", String(busy));
    if (busy) {
      m.busyFocus = document.activeElement;
      m.disabled = [
        ...m.panel.querySelectorAll("button,input,select,textarea"),
      ].map((el) => [el, el.disabled]);
      m.disabled.forEach(([el]) => (el.disabled = true));
      m.panel.focus({ preventScroll: true });
    } else {
      m.disabled?.forEach(([el, disabled]) => (el.disabled = disabled));
      if (m.busyFocus?.isConnected && !m.busyFocus.disabled)
        m.busyFocus.focus({ preventScroll: true });
      m.disabled = null;
    }
    return true;
  }
  function nav() {
    const html = tabs
      .map(
        ([key, label, symbol]) =>
          `<button class="nav-link" data-nav="${key}" ${state.view === key ? 'aria-current="page"' : ""}>${icon(symbol)}<span>${label}</span>${key === "library" ? `<span class="nav-count">${store.list().length}</span>` : ""}</button>`,
      )
      .join("");
    $("desktop-nav").innerHTML = html;
    $("mobile-nav").innerHTML = html;
    $("side-folders").innerHTML = store
      .folders()
      .filter((f) => f !== "미분류")
      .map(
        (f) =>
          `<button class="side-folder" data-folder="${esc(f)}">${icon("folder")}<span>${esc(f)}</span></button>`,
      )
      .join("");
    storageStatus();
  }
  function filtered() {
    const words = state.query
      .trim()
      .toLocaleLowerCase()
      .split(/\s+/)
      .filter(Boolean);
    return store
      .list()
      .filter(
        (p) =>
          (!state.folder || p.folder === state.folder) &&
          (state.platform === "전체" || p.platform === state.platform) &&
          (!state.favorite || p.favorite) &&
          (state.view !== "search" ||
            words.every((w) =>
              [p.title, p.note, p.url, p.folder, ...p.tags]
                .join(" ")
                .toLocaleLowerCase()
                .includes(w),
            )),
      )
      .sort((a, b) =>
        state.sort === "old"
          ? a.savedAt - b.savedAt
          : state.sort === "title"
            ? a.title.localeCompare(b.title, "ko")
            : b.savedAt - a.savedAt,
      );
  }
  function card(p) {
    return `<article class="clip-card"><button class="card-open" data-item="${p.id}" aria-label="${esc(p.title)} 상세 보기"><div class="card-visual">${thumb(p)}<span class="card-platform">${icon(p.platform === "YouTube" ? "play" : p.platform === "Instagram" ? "video" : p.platform === "스크린샷" ? "image" : "link")}${esc(p.platform)}${p.sample ? " · 샘플" : ""}</span></div><h2 class="card-title">${esc(p.title)}</h2><div class="card-meta"><span>${esc(p.folder)}</span><time>${date(p.savedAt)}</time></div></button><button class="favorite-toggle" data-favorite="${p.id}" aria-label="${esc(p.title)} 즐겨찾기" aria-pressed="${p.favorite}">${icon("bookmark")}</button></article>`;
  }
  function empty() {
    const has = store
      .list()
      .some((item) => !state.folder || item.folder === state.folder);
    return `<div class="empty-state">${icon(has ? "search-x" : "inbox")}<h2>${has ? "표시할 항목이 없습니다" : "아직 저장한 항목이 없습니다"}</h2><p>${has ? "검색어나 선택한 필터를 변경해보세요." : "링크 또는 이미지를 추가할 수 있습니다."}</p><button class="secondary" data-action="${has ? "clear-filters" : "add"}">${has ? "필터 초기화" : "첫 항목 추가"}</button></div>`;
  }
  function cardsHTML() {
    const items = filtered();
    return `<div class="results-meta"><span>${state.view === "search" && state.query ? `검색 결과 ${items.length}개` : state.folder ? `${items.length}개 항목` : `전체 저장 항목 ${items.length}개`}</span><span>${state.favorite ? "즐겨찾기" : ""}</span></div>${items.length ? `<div class="cards ${state.layout === "list" ? "list-view" : ""}">${items.map(card).join("")}</div>` : empty()}`;
  }
  function filters() {
    return `<div class="toolbar"><div class="filters" aria-label="플랫폼 필터">${["전체", "스크린샷", "YouTube", "Instagram", "웹 링크"].map((p) => `<button class="filter" data-platform="${p}" aria-pressed="${state.platform === p}">${p}</button>`).join("")}</div><div class="tools"><button class="icon-button small" data-action="favorites" aria-label="즐겨찾기만 보기" aria-pressed="${state.favorite}">${icon(state.favorite ? "bookmark-check" : "bookmark")}</button><button class="sort-button" data-action="sort">${{ new: "최신순", old: "오래된순", title: "제목순" }[state.sort]}${icon("chevron-down")}</button><button class="icon-button small" data-action="layout" aria-label="${state.layout === "grid" ? "목록으로 보기" : "격자로 보기"}">${icon(state.layout === "grid" ? "list" : "layout-grid")}</button></div></div>`;
  }
  function render({ keepScroll = false, keepFocus = true } = {}) {
    const y = window.scrollY,
      innerY = $("content").scrollTop,
      focus = keepFocus ? focusKey() : null;
    orbit?.destroy();
    orbit = null;
    nav();
    $("main").dataset.view = state.view;
    const title = state.folder || tabs.find((t) => t[0] === state.view)[1];
    $("heading").innerHTML =
      `<div class="heading-row">${state.folder ? `<button class="icon-button bordered" data-action="back-folder" aria-label="전체 폴더로 돌아가기">${icon("arrow-left")}</button>` : ""}<h1 id="page-title" tabindex="-1">${esc(title)}</h1></div>`;
    $("header-actions").innerHTML =
      `${state.view === "feed" ? `<div class="feed-switch" aria-label="피드 보기 방식"><button data-feed-mode="orbit" aria-label="원형 피드" aria-pressed="${state.feed === "orbit"}">${icon("orbit")}</button><button data-feed-mode="grid" aria-label="격자 피드" aria-pressed="${state.feed === "grid"}">${icon("layout-grid")}</button></div>` : `<button class="icon-button bordered mobile-help" data-action="help" aria-label="시안 안내 및 데이터 내보내기">${icon("info")}</button>`}${state.view === "folders" && !state.folder ? `<button class="icon-button bordered" data-action="new-folder" aria-label="폴더 만들기">${icon("folder-plus")}</button>` : ""}<button class="icon-button add-button" data-action="add" aria-label="항목 추가">${icon("plus")}</button>`;
    const content = $("content");
    content.className = "content";
    if (state.view === "feed") {
      const all = store.list().sort((a, b) => b.savedAt - a.savedAt);
      if (state.feed === "orbit" && all.length) {
        content.innerHTML =
          '<div class="feed-stage" id="orbit"></div><button class="icon-button bordered feed-reset" data-action="reset-orbit" aria-label="피드 중앙으로 이동">' +
          icon("scan") +
          "</button>";
        orbit = window.createStorygeOrbit($("orbit"), all, openDetail);
      } else {
        content.classList.add("feed-grid");
        content.innerHTML = all.length
          ? `<div class="cards">${all.map(card).join("")}</div>`
          : empty();
      }
    } else if (state.view === "folders" && !state.folder) {
      content.innerHTML = `<div class="folders">${store
        .folders()
        .map((f) => {
          const list = store.list().filter((p) => p.folder === f),
            photos = list.filter((p) => p.image).slice(0, 3);
          return `<button class="folder-card" data-folder="${esc(f)}"><div class="folder-cover">${photos.length ? photos.map((p) => thumb(p)).join("") : `<div class="folder-blank">${icon("folder")}</div>`}</div><div class="folder-caption"><h2>${esc(f)}</h2><span>${list.length}개 항목</span></div></button>`;
        })
        .join("")}</div>`;
    } else if (state.view === "search") {
      content.innerHTML = `<div class="search-field">${icon("search")}<input id="search-input" type="search" autocomplete="off" placeholder="제목, 키워드, 메모 검색" aria-label="저장 항목 검색" value="${esc(state.query)}"><button class="icon-button small" data-action="clear-search" aria-label="검색어 지우기">${icon("x")}</button></div><section class="search-suggestions" ${state.query.trim() ? "hidden" : ""}><h2>키워드로 찾기</h2>${[
        ...new Set(store.list().flatMap((p) => p.tags)),
      ]
        .slice(0, 6)
        .map(
          (t) =>
            `<button class="suggestion" data-query="${esc(t)}">${icon("hash")}${esc(t)}</button>`,
        )
        .join("")}</section>${filters()}<div id="results">${cardsHTML()}</div>`;
    } else
      content.innerHTML = filters() + `<div id="results">${cardsHTML()}</div>`;
    icons();
    imageFallback();
    content.scrollTop = keepScroll ? innerY : 0;
    if (keepScroll) window.scrollTo(0, y);
    else window.scrollTo(0, 0);
    if (focus) restoreFocus(focus);
  }
  function navigate(view, folder = "") {
    const old = tabs.findIndex((t) => t[0] === state.view),
      next = tabs.findIndex((t) => t[0] === view);
    state.view = view;
    state.folder = folder;
    state.platform = "전체";
    state.favorite = false;
    state.query = "";
    render({ keepFocus: false });
    navAnimation?.cancel();
    if (!reduce.matches && !keyboard)
      navAnimation = $("content").animate(
        [
          { transform: `translateX(${next >= old ? 20 : -20}px)` },
          { transform: "translateX(0)" },
        ],
        { duration: 260, easing: "cubic-bezier(.23,1,.32,1)" },
      );
    if (keyboard) $("page-title").focus({ preventScroll: true });
  }
  function openModal(
    title,
    body,
    { kind = "", onClose, trigger = document.activeElement } = {},
  ) {
    if (modal) return null;
    const layer = document.createElement("div");
    layer.className = `modal-layer ${kind}`;
    layer.innerHTML = `<section class="dialog ${kind === "detail-layer" ? "detail-dialog" : ""}" role="dialog" aria-modal="true" aria-labelledby="dialog-title" tabindex="-1"><div class="sheet-handle" aria-hidden="true"></div><header class="dialog-header">${kind === "detail-layer" ? `<button class="icon-button bordered" data-close aria-label="이전 화면으로 돌아가기">${icon("arrow-left")}</button>` : ""}<h2 id="dialog-title">${esc(title)}</h2><button class="icon-button" data-close aria-label="닫기">${icon("x")}</button></header><div class="dialog-body">${body}</div></section>`;
    $("modal-root").append(layer);
    $("app").inert = true;
    orbit?.pause();
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const panel = layer.querySelector(".dialog");
    modal = {
      layer,
      panel,
      trigger,
      focus: focusKey(trigger),
      onClose,
      oldOverflow,
      closing: false,
      busy: false,
    };
    icons();
    imageFallback(layer);
    panel.focus({ preventScroll: true });
    if (!reduce.matches && !keyboard)
      modal.animation = panel.animate(
        [
          {
            transform:
              kind === "detail-layer" ? "translateX(100%)" : "translateY(100%)",
          },
          { transform: "translate(0)" },
        ],
        {
          duration: kind === "detail-layer" ? 440 : 380,
          easing: "cubic-bezier(.32,.72,0,1)",
        },
      );
    layer.addEventListener("click", (e) => {
      if (e.target === layer || e.target.closest("[data-close]")) closeModal();
    });
    let drag = null;
    const handle = layer.querySelector(".sheet-handle");
    handle.addEventListener("pointerdown", (e) => {
      if (drag || modal?.busy || modal?.closing) return;
      drag = { id: e.pointerId, y: e.clientY, time: performance.now(), dy: 0 };
      modal?.animation?.cancel();
      handle.setPointerCapture(e.pointerId);
    });
    handle.addEventListener("pointermove", (e) => {
      if (!drag || drag.id !== e.pointerId) return;
      drag.dy = Math.max(0, e.clientY - drag.y);
      panel.style.transform = `translateY(${drag.dy}px)`;
    });
    const end = (e) => {
      if (!drag || drag.id !== e.pointerId) return;
      const dismiss =
        e.type !== "pointercancel" &&
        (drag.dy > 100 ||
          drag.dy / Math.max(1, performance.now() - drag.time) > 0.6);
      drag = null;
      if (dismiss) closeModal();
      else {
        if (!reduce.matches)
          panel.animate(
            [
              { transform: panel.style.transform },
              { transform: "translateY(0)" },
            ],
            { duration: 220, easing: "cubic-bezier(.23,1,.32,1)" },
          );
        panel.style.transform = "";
      }
    };
    handle.addEventListener("pointerup", end);
    handle.addEventListener("pointercancel", end);
    return layer;
  }
  async function closeModal({
    after,
    immediate = false,
    owner,
    complete = false,
  } = {}) {
    const m = modal;
    if (!m || m.closing || (owner && m.layer !== owner)) return;
    if (m.busy && !complete) {
      notify("저장 중입니다. 잠시 기다려 주세요.");
      return;
    }
    if (m.beforeClose && !complete && !(await m.beforeClose())) return;
    if (modal !== m || m.closing) return;
    m.closing = true;
    const transform = getComputedStyle(m.panel).transform;
    m.animation?.cancel();
    if (!immediate && !reduce.matches && !keyboard) {
      const out = m.panel.animate(
        [
          { transform },
          {
            transform: m.layer.classList.contains("detail-layer")
              ? "translateX(100%)"
              : "translateY(100%)",
          },
        ],
        {
          duration: 300,
          easing: "cubic-bezier(.32,.72,0,1)",
          fill: "forwards",
        },
      );
      await out.finished.catch(() => {});
    }
    m.layer.remove();
    modal = null;
    $("app").inert = false;
    document.body.style.overflow = m.oldOverflow;
    orbit?.resume();
    m.onClose?.();
    after?.();
    if (!modal) {
      if (
        m.trigger?.isConnected &&
        m.trigger.getClientRects().length &&
        !m.trigger.disabled
      )
        m.trigger.focus({ preventScroll: true });
      else restoreFocus(m.focus);
    }
  }
  function choose(title, options, value, callback) {
    const layer = openModal(
      title,
      `<div class="menu-options" role="menu" aria-label="${esc(title)}">${options.map(([v, label]) => `<button class="menu-option" role="menuitemradio" aria-checked="${v === value}" tabindex="${v === value ? 0 : -1}" data-value="${esc(v)}">${esc(label)}${v === value ? icon("check") : ""}</button>`).join("")}</div>`,
      { kind: "mini-menu" },
    );
    if (!layer) return;
    const buttons = [...layer.querySelectorAll("[data-value]")];
    buttons.forEach(
      (b) =>
        (b.onclick = () =>
          closeModal({ owner: layer, after: () => callback(b.dataset.value) })),
    );
    const focus = (i) => {
      buttons.forEach((b, n) => (b.tabIndex = n === i ? 0 : -1));
      buttons[i].focus({ preventScroll: true });
    };
    layer.querySelector("[role=menu]").onkeydown = (e) => {
      if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) return;
      e.preventDefault();
      const current = buttons.indexOf(document.activeElement),
        next =
          e.key === "Home"
            ? 0
            : e.key === "End"
              ? buttons.length - 1
              : (current + (e.key === "ArrowDown" ? 1 : -1) + buttons.length) %
                buttons.length;
      focus(next);
    };
    focus(
      Math.max(
        0,
        buttons.findIndex((b) => b.dataset.value === value),
      ),
    );
  }
  function addFolder() {
    const layer = openModal(
      "새 폴더",
      `<form id="folder-form"><label class="field">폴더 이름<input name="name" maxlength="60" required autocomplete="off" placeholder="예: 다음 여행"></label><p class="form-error" role="alert"></p><button class="primary" type="submit">폴더 만들기</button></form>`,
    );
    if (!layer) return;
    layer.querySelector("form").onsubmit = async (e) => {
      e.preventDefault();
      const name = new FormData(e.target).get("name")?.trim();
      if (!setModalBusy(layer, true)) return;
      try {
        await mutate(() => store.addFolder(name));
        await closeModal({
          owner: layer,
          complete: true,
          after: () => {
            navigate("folders", name);
            notify("폴더를 만들었습니다");
          },
        });
      } catch (err) {
        layer.querySelector(".form-error").textContent = err.message;
        setModalBusy(layer, false);
      }
    };
  }
  function addItem() {
    const layer = openModal(
      "항목 추가",
      `<div class="save-modes" role="tablist" aria-label="추가 방식"><button class="save-mode" id="mode-link" role="tab" aria-selected="true" data-mode="link">${icon("link")}링크</button><button class="save-mode" id="mode-image" role="tab" aria-selected="false" data-mode="image">${icon("image")}이미지</button></div><form id="add-form"><div id="save-input"></div><label class="field"><span>제목 <span class="field-note">선택 사항</span></span><input name="title" maxlength="200" placeholder="내용을 알아볼 수 있는 제목"></label><label class="field">폴더<select name="folder">${store
        .folders()
        .map(
          (f) =>
            `<option ${f === (state.folder || "미분류") ? "selected" : ""}>${esc(f)}</option>`,
        )
        .join(
          "",
        )}</select></label><p class="form-error" role="alert"></p><button class="primary" id="save-submit" type="submit">저장하기${icon("arrow-up-right")}</button></form><div class="note-line">${icon("hard-drive")}<span>이 브라우저에 저장됩니다. AI 자동 분류와 원본 검색은 아직 연결되지 않았습니다.</span></div>`,
    );
    if (!layer) return;
    let mode = "link",
      file = null,
      busy = false;
    function input() {
      layer.querySelectorAll("[data-mode]").forEach((b) => {
        b.setAttribute("aria-selected", String(b.dataset.mode === mode));
        b.setAttribute("aria-controls", "save-input");
        b.tabIndex = b.dataset.mode === mode ? 0 : -1;
      });
      const panel = layer.querySelector("#save-input");
      panel.setAttribute("role", "tabpanel");
      panel.setAttribute("aria-labelledby", `mode-${mode}`);
      layer.querySelector("#save-input").innerHTML =
        mode === "link"
          ? '<label class="field">URL<input name="url" type="url" required autocomplete="url" placeholder="https://" aria-label="저장할 URL"></label>'
          : `<label class="upload-zone">${icon("image-plus")}<strong id="file-label">이미지 선택</strong><small>JPG, PNG, WebP · 최대 8 MB · 한 번에 1개</small><input type="file" name="image" accept="image/jpeg,image/png,image/webp" aria-label="저장할 이미지"></label>`;
      icons();
      const upload = layer.querySelector("[type=file]");
      if (upload)
        upload.onchange = () => {
          file = upload.files[0];
          layer.querySelector("#file-label").textContent =
            file?.name || "이미지 선택";
        };
    }
    input();
    layer.querySelectorAll("[data-mode]").forEach(
      (b) =>
        (b.onclick = () => {
          if (busy || mode === b.dataset.mode) return;
          mode = b.dataset.mode;
          file = null;
          input();
        }),
    );
    layer.querySelector("[role=tablist]").onkeydown = (e) => {
      if (busy || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key))
        return;
      e.preventDefault();
      const buttons = [...layer.querySelectorAll("[data-mode]")],
        next =
          e.key === "Home" ? 0 : e.key === "End" ? 1 : mode === "link" ? 1 : 0;
      buttons[next].click();
      buttons[next].focus({ preventScroll: true });
    };
    layer.querySelector("form").onsubmit = async (e) => {
      e.preventDefault();
      if (busy) return;
      const form = new FormData(e.target);
      if (!setModalBusy(layer, true)) return;
      busy = true;
      const button = layer.querySelector("#save-submit"),
        error = layer.querySelector(".form-error");
      error.textContent = "";
      button.textContent = "저장 중…";
      try {
        let data = {
          title: form.get("title").trim(),
          folder: form.get("folder"),
          tags: [],
          note: "",
        };
        if (mode === "link") {
          data.url = safeURL(form.get("url").trim());
          if (!data.url)
            throw Error("http 또는 https로 시작하는 URL을 입력하세요.");
          if (!data.title) data.title = host(data.url);
        } else {
          if (!file) throw Error("이미지를 선택하세요.");
          if (!["image/jpeg", "image/png", "image/webp"].includes(file.type))
            throw Error("JPG, PNG, WebP 이미지만 저장할 수 있습니다.");
          if (file.size > 8 * 1024 * 1024)
            throw Error("8 MB 이하의 이미지를 선택하세요.");
          data.image = await readImage(file);
          data.title = data.title || file.name;
          data.platform = "스크린샷";
        }
        await mutate(() => store.add(data));
        await closeModal({
          owner: layer,
          complete: true,
          after: () => {
            render({ keepScroll: true });
            notify(
              store.storageMode === "persistent"
                ? "항목을 저장했습니다"
                : "항목이 임시 저장되었습니다. 내보내기로 보관하세요.",
            );
          },
        });
      } catch (err) {
        error.textContent = err.message;
        button.innerHTML = "저장하기" + icon("arrow-up-right");
        setModalBusy(layer, false);
        icons();
      } finally {
        busy = false;
      }
    };
  }
  function readImage(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () =>
        reject(Error("파일을 읽지 못했습니다. 다시 선택하세요."));
      reader.onload = () => {
        const img = new Image();
        img.onload = () => resolve(reader.result);
        img.onerror = () => reject(Error("이미지 파일을 확인하세요."));
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }
  function refreshMetadata() {
    // Notes and bookmarks do not change the orbit's visuals. Preserve the user's pan.
    if (state.view === "feed" && state.feed === "orbit") return;
    render({ keepScroll: true });
  }
  function openDetail(id, trigger) {
    const p = store.list().find((p) => p.id === id);
    if (!p) return;
    const source = safeURL(p.url),
      sourceLabel = p.sample ? "샘플 사진 출처" : "원본 열기";
    const body = `${p.image ? `<img class="detail-image" src="${esc(p.image)}" alt="${esc(p.title)}">` : `<div class="detail-image card-placeholder">${icon("link")}<span>${esc(host(p.url))}</span></div>`}<div class="detail-domain">${icon(p.platform === "스크린샷" ? "image" : "link")}<span>${esc(p.platform)}${p.sample ? " · 샘플" : ""}</span></div><h3 class="detail-title">${esc(p.title)}</h3><p class="detail-source-note">${p.sample ? "데모 항목입니다. 링크는 영상·상품이 아닌 사진 출처로 연결됩니다." : source ? esc(host(p.url)) : "원본 URL이 없습니다. 이미지 원본 검색은 연결 전입니다."}</p><dl class="detail-data"><div class="data-row"><dt>폴더</dt><dd><button class="text-action" data-edit>${esc(p.folder)}${icon("chevron-right")}</button></dd></div><div class="data-row"><dt>키워드</dt><dd><button class="text-action" data-edit>${p.tags.length ? esc(p.tags.join(" · ")) : "키워드 추가"}${icon("pencil")}</button></dd></div><div class="data-row"><dt>저장 날짜</dt><dd>${new Date(p.savedAt).toLocaleDateString("ko-KR")}${p.sample ? " · 예시" : ""}</dd></div></dl><div class="detail-note"><label for="item-note">메모</label><textarea id="item-note" maxlength="4000" placeholder="저장한 이유나 참고할 내용을 남기세요.">${esc(p.note)}</textarea><div class="note-actions"><button class="quiet-button" data-save-note>메모 저장</button></div></div><button class="delete-link" data-delete>${icon("trash-2")}항목 삭제</button>`;
    const layer = openModal("저장 항목", body, {
      kind: "detail-layer",
      trigger,
    });
    if (!layer) return;
    const footer = document.createElement("footer");
    footer.className = "detail-footer";
    footer.innerHTML = `${source ? `<a class="primary" href="${esc(source)}" target="_blank" rel="noopener noreferrer">${sourceLabel}${icon("arrow-up-right")}</a>` : '<button class="primary" disabled>원본 링크 없음</button>'}<button class="secondary" data-fav aria-label="즐겨찾기" aria-pressed="${p.favorite}">${icon(p.favorite ? "bookmark-check" : "bookmark")}</button>${source ? `<button class="secondary" data-copy aria-label="링크 복사">${icon("copy")}</button>` : ""}`;
    layer.querySelector(".dialog").append(footer);
    icons();
    const owner = modal;
    let savedNote = p.note;
    const note = layer.querySelector("#item-note"),
      noteButton = layer.querySelector("[data-save-note]");
    const noteStatus = document.createElement("span");
    noteStatus.className = "field-note";
    noteStatus.setAttribute("role", "status");
    noteButton.before(noteStatus);
    note.addEventListener("input", () => {
      noteStatus.textContent =
        note.value === savedNote ? "" : "닫을 때 메모가 저장됩니다";
    });
    async function saveNote(silent = false) {
      if (note.value === savedNote) return true;
      const value = note.value;
      if (!setModalBusy(layer, true)) return false;
      noteStatus.textContent = "메모 저장 중…";
      try {
        const updated = await mutate(() => store.update(id, { note: value }));
        savedNote = updated.note;
        note.value = savedNote;
        noteStatus.textContent =
          store.storageMode === "persistent" ? "저장됨" : "임시 저장됨";
        owner.onClose = refreshMetadata;
        if (!silent)
          notify(
            store.storageMode === "persistent"
              ? "메모를 저장했습니다"
              : "메모가 임시 저장되었습니다. 내보내기로 보관하세요.",
          );
        return true;
      } catch (err) {
        noteStatus.textContent = err.message;
        return false;
      } finally {
        setModalBusy(layer, false);
      }
    }
    owner.beforeClose = () => note.value === savedNote || saveNote(true);
    layer.querySelectorAll("[data-edit]").forEach(
      (b) =>
        (b.onclick = () =>
          closeModal({
            owner: layer,
            after: () => editItem(id, owner.trigger),
          })),
    );
    noteButton.onclick = () => saveNote();
    layer.querySelector("[data-fav]").onclick = async (e) => {
      const button = e.currentTarget;
      if (!setModalBusy(layer, true)) return;
      try {
        const current = store.list().find((x) => x.id === id);
        const next = await mutate(() =>
          store.update(id, { favorite: !current.favorite }),
        );
        button.setAttribute("aria-pressed", String(next.favorite));
        button.innerHTML = icon(next.favorite ? "bookmark-check" : "bookmark");
        icons();
        owner.onClose = refreshMetadata;
      } catch (err) {
        notify(err.message);
      } finally {
        setModalBusy(layer, false);
      }
    };
    layer.querySelector("[data-copy]")?.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(source);
        notify("링크를 복사했습니다");
      } catch {
        notify("복사하지 못했습니다. 원본을 열어 주소를 복사하세요.");
      }
    });
    layer.querySelector("[data-delete]").onclick = async () => {
      if (!setModalBusy(layer, true)) return;
      try {
        const deleted = await mutate(() => store.remove(id));
        owner.onClose = null;
        await closeModal({
          owner: layer,
          complete: true,
          after: () => {
            render({ keepScroll: true });
            notify("항목을 삭제했습니다", {
              label: "실행 취소",
              run: async () => {
                await mutate(() => store.restore(deleted));
                render({ keepScroll: true });
              },
            });
          },
        });
      } catch (e) {
        notify(e.message);
        setModalBusy(layer, false);
      }
    };
  }
  function editItem(id, returnTrigger) {
    const p = store.list().find((x) => x.id === id);
    if (!p) return;
    const layer = openModal(
      "항목 편집",
      `<form><label class="field">제목<input name="title" value="${esc(p.title)}" maxlength="200" required></label><label class="field">폴더<select name="folder">${store
        .folders()
        .map(
          (f) =>
            `<option ${p.folder === f ? "selected" : ""}>${esc(f)}</option>`,
        )
        .join(
          "",
        )}</select></label><label class="field">키워드<input name="tags" value="${esc(p.tags.join(", "))}" placeholder="쉼표로 구분"><span class="field-note">최대 20개</span></label><p class="form-error" role="alert"></p><button type="submit" class="primary">변경 저장</button></form>`,
    );
    if (!layer) return;
    modal.onClose = () => {
      render({ keepScroll: true });
      openDetail(id, returnTrigger);
    };
    layer.querySelector("form").onsubmit = async (e) => {
      e.preventDefault();
      const f = new FormData(e.target);
      if (!setModalBusy(layer, true)) return;
      try {
        await mutate(() =>
          store.update(id, {
            title: f.get("title"),
            folder: f.get("folder"),
            tags: f
              .get("tags")
              .split(",")
              .map((t) => t.trim())
              .filter(Boolean),
          }),
        );
        await closeModal({
          owner: layer,
          complete: true,
          after: () => notify("변경 사항을 저장했습니다"),
        });
      } catch (err) {
        layer.querySelector(".form-error").textContent = err.message;
        setModalBusy(layer, false);
      }
    };
  }
  function help() {
    const layer = openModal(
      "Storyge V3",
      `<p>이 시안은 브라우저에서 실행되는 개인 보관함입니다.</p><dl class="detail-data"><div class="data-row"><dt>사용 가능</dt><dd>링크·이미지 저장<br>검색·폴더·즐겨찾기·메모</dd></div><div class="data-row"><dt>저장 위치</dt><dd>${store.storageMode === "persistent" ? "이 브라우저의 IndexedDB" : "임시 메모리"}</dd></div><div class="data-row"><dt>연결 전</dt><dd>계정·기기 간 동기화<br>OS 공유·AI 분류·원본 검색·RAG</dd></div></dl><p>브라우저 데이터를 지우면 저장한 항목도 삭제됩니다. 중요한 항목은 내보내기로 별도 보관하세요. 샘플 항목의 플랫폼과 날짜는 예시입니다.</p><button class="secondary" id="export-data">${icon("download")}저장 데이터 내보내기</button><p class="field-note">JSON 파일에 이미지, 메모, URL이 포함됩니다. 개인 정보를 확인한 뒤 공유하세요.</p>`,
    );
    if (!layer) return;
    layer.querySelector("#export-data").onclick = () => {
      const blob = new Blob([JSON.stringify(store.exportData(), null, 2)], {
          type: "application/json",
        }),
        url = URL.createObjectURL(blob),
        a = document.createElement("a");
      a.href = url;
      a.download = "storyge-backup.json";
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      notify("내보내기 파일을 준비했습니다");
    };
  }
  document.addEventListener("click", async (e) => {
    const b = e.target.closest("button");
    if (!b || b.closest(".modal-layer")) return;
    if (b.dataset.nav) {
      navigate(b.dataset.nav);
      return;
    }
    if (b.dataset.folder) {
      navigate("folders", b.dataset.folder);
      return;
    }
    if (b.dataset.item) {
      openDetail(b.dataset.item, b);
      return;
    }
    if (b.dataset.favorite) {
      try {
        const p = store.list().find((p) => p.id === b.dataset.favorite);
        await mutate(() => store.update(p.id, { favorite: !p.favorite }));
        render({ keepScroll: true });
      } catch (err) {
        notify(err.message);
      }
      return;
    }
    if (b.dataset.platform) {
      state.platform = b.dataset.platform;
      render({ keepScroll: true });
      return;
    }
    if (b.dataset.query) {
      state.query = b.dataset.query;
      render();
      $("search-input").focus({ preventScroll: true });
      return;
    }
    if (b.dataset.feedMode) {
      state.feed = b.dataset.feedMode;
      render();
      return;
    }
    switch (b.dataset.action) {
      case "add":
        addItem();
        break;
      case "new-folder":
        addFolder();
        break;
      case "back-folder":
        navigate("folders");
        break;
      case "search":
        navigate("search");
        $("search-input").focus({ preventScroll: true });
        break;
      case "help":
        help();
        break;
      case "reset-orbit":
        orbit?.reset();
        break;
      case "clear-filters":
        state.platform = "전체";
        state.favorite = false;
        state.query = "";
        render();
        break;
      case "clear-search":
        state.query = "";
        render();
        $("search-input").focus({ preventScroll: true });
        break;
      case "favorites":
        state.favorite = !state.favorite;
        render({ keepScroll: true });
        break;
      case "layout":
        state.layout = state.layout === "grid" ? "list" : "grid";
        render({ keepScroll: true });
        break;
      case "sort":
        choose(
          "정렬",
          [
            ["new", "최신순"],
            ["old", "오래된순"],
            ["title", "제목순"],
          ],
          state.sort,
          (value) => {
            state.sort = value;
            render({ keepScroll: true });
          },
        );
        break;
    }
  });
  document.addEventListener("input", (e) => {
    if (e.target.id === "search-input" && !e.isComposing)
      search(e.target.value);
  });
  document.addEventListener("compositionend", (e) => {
    if (e.target.id === "search-input") search(e.target.value);
  });
  function search(value) {
    state.query = value;
    $("results").innerHTML = cardsHTML();
    const suggestions = document.querySelector(".search-suggestions");
    if (suggestions) suggestions.hidden = Boolean(value.trim());
    icons();
    imageFallback($("results"));
  }
  document.addEventListener("keydown", (e) => {
    if (modal) {
      if (e.key === "Escape") {
        e.preventDefault();
        closeModal();
      }
      if (e.key === "Tab") {
        const nodes = [
          ...modal.panel.querySelectorAll(
            "button,a[href],input,select,textarea",
          ),
        ].filter(
          (el) =>
            !el.disabled && el.tabIndex >= 0 && el.getClientRects().length,
        );
        const first = nodes[0],
          last = nodes.at(-1);
        if (!first) {
          e.preventDefault();
          return;
        }
        if (
          e.shiftKey &&
          (document.activeElement === first ||
            document.activeElement === modal.panel)
        ) {
          e.preventDefault();
          last.focus();
        } else if (
          !e.shiftKey &&
          (document.activeElement === last ||
            document.activeElement === modal.panel)
        ) {
          e.preventDefault();
          first.focus();
        }
      }
      return;
    }
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
      e.preventDefault();
      navigate("search");
      $("search-input").focus({ preventScroll: true });
    }
    if (e.key === "Escape" && state.folder) navigate("folders");
  });
  const viewport = () =>
    document.documentElement.style.setProperty(
      "--viewport-height",
      `${window.visualViewport?.height || innerHeight}px`,
    );
  window.visualViewport?.addEventListener("resize", viewport);
  viewport();
  try {
    await store.ready();
    render();
    icons();
    if (store.storageMode === "memory")
      notify(store.errorMessage || "임시 저장 모드입니다.");
  } catch (err) {
    $("content").innerHTML =
      '<div class="empty-state"><h2>보관함을 열지 못했습니다</h2><p>페이지를 새로고침해 주세요.</p></div>';
    console.error(err);
  }
  setTimeout(() => {
    const splash = $("launch");
    if (!reduce.matches) {
      const a = splash.animate(
        [{ transform: "translateY(0)" }, { transform: "translateY(-100%)" }],
        { duration: 480, easing: "cubic-bezier(.32,.72,0,1)" },
      );
      a.onfinish = () => splash.remove();
    } else splash.remove();
  }, 550);
})();
