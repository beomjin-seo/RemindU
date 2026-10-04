(function () {
  "use strict";

  const clamp = (value, low, high) => Math.min(high, Math.max(low, value));
  const ROOT3 = Math.sqrt(3);
  const rubberBand = (value, limit, dimension) => {
    const excess = Math.max(0, Math.abs(value) - limit);
    if (!excess) return value;
    const resistance = dimension * 0.2;
    return (
      Math.sign(value) * (limit + (resistance * excess) / (resistance + excess))
    );
  };

  /**
   * Image-only constellation. onOpen receives (item.id, triggerButton).
   * Call destroy before removing/replacing the host; pause/resume around dialogs.
   * No timers, network requests, or content copies are created by this component.
   */
  window.createStorygeOrbit = function createStorygeOrbit(host, items, onOpen) {
    if (!(host instanceof HTMLElement))
      throw new TypeError("Orbit requires a host element.");
    const controller = new AbortController();
    const signal = controller.signal;
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const originalLabel = host.getAttribute("aria-label");
    const originalRole = host.getAttribute("role");
    const nodes = [];
    const fragment = document.createDocumentFragment();
    let width = 0,
      height = 0,
      diameter = 104;
    let limitX = 0,
      limitY = 0;
    let panX = 0,
      panY = 0,
      velocityX = 0,
      velocityY = 0;
    let pointer = null,
      pointerX = 0,
      pointerY = 0,
      lens = 0;
    let focusedNode = null,
      externalPause = false,
      intersecting = true;
    let blocked = false,
      destroyed = false,
      frame = 0,
      previousTime = 0;
    let ignoreClickUntil = 0,
      runningTime = 0;
    let rect = null;

    host.classList.add("storyge-orbit");
    host.setAttribute("role", "group");
    host.setAttribute(
      "aria-label",
      "저장한 항목. 드래그로 둘러보기, 방향키로 항목 이동, Enter로 열기",
    );

    items.forEach((item, index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "orbit-item";
      button.tabIndex = index === 0 ? 0 : -1;
      button.setAttribute(
        "aria-label",
        [item.title || "저장한 항목", item.platform]
          .filter(Boolean)
          .join(" · "),
      );
      button.dataset.orbitIndex = String(index);
      const image = document.createElement("img");
      image.alt = "";
      image.draggable = false;
      image.decoding = "async";
      image.loading = index < 19 ? "eager" : "lazy";
      if (item.image) image.src = item.image;
      else button.classList.add("has-image-error");
      image.addEventListener(
        "error",
        () => button.classList.add("has-image-error"),
        { signal },
      );
      const fallback = document.createElement("span");
      fallback.className = "orbit-fallback";
      fallback.setAttribute("aria-hidden", "true");
      fallback.textContent = Array.from((item.title || "S").trim())[0] || "S";
      button.append(image, fallback);
      fragment.append(button);
      nodes.push({
        item,
        button,
        x: 0,
        y: 0,
        scale: 1,
        phase: index * 2.39996,
        transform: "",
        visible: false,
      });
    });
    host.append(fragment);

    function layout() {
      if (destroyed) return;
      rect = host.getBoundingClientRect();
      width = host.clientWidth;
      height = host.clientHeight;
      if (!width || !height) return;
      const aspect = clamp(width / height, 0.64, 1.8);
      const rings = Math.max(3, Math.ceil(Math.sqrt(nodes.length)));
      const pairs = [];
      for (let row = -rings; row <= rings; row++) {
        for (let col = -rings; col <= rings; col++) {
          const x = col + row / 2;
          const y = (row * ROOT3) / 2;
          if (x > 0 || (x === 0 && y > 0)) {
            pairs.push({ x, y, score: (x / aspect) ** 2 + y ** 2 });
          }
        }
      }
      pairs.sort((a, b) => a.score - b.score || a.y - b.y || a.x - b.x);
      const points = [{ x: 0, y: 0 }];
      for (const pair of pairs) {
        if (points.length >= nodes.length) break;
        points.push({ x: pair.x, y: pair.y });
        if (points.length < nodes.length)
          points.push({ x: -pair.x, y: -pair.y });
      }
      const used = points.slice(0, nodes.length);
      const xs = used.map((point) => point.x),
        ys = used.map((point) => point.y);
      const minX = Math.min(0, ...xs),
        maxX = Math.max(0, ...xs);
      const minY = Math.min(0, ...ys),
        maxY = Math.max(0, ...ys);
      const spanX = (maxX - minX) * 1.065 + 1;
      const spanY = (maxY - minY) * 1.065 + 1;
      const minimum = Math.min(88, width * 0.23);
      diameter = clamp(
        Math.min((width - 38) / spanX, (height - 38) / spanY),
        minimum,
        nodes.length < 4 ? 216 : 184,
      );
      host.style.setProperty("--orbit-size", `${diameter}px`);
      nodes.forEach((node, index) => {
        node.x = (used[index].x - (minX + maxX) / 2) * diameter * 1.065;
        node.y = (used[index].y - (minY + maxY) / 2) * diameter * 1.065;
      });
      limitX = Math.max(0, (diameter * spanX) / 2 - width / 2 + 22);
      limitY = Math.max(0, (diameter * spanY) / 2 - height / 2 + 22);
      panX = clamp(panX, -limitX, limitX);
      panY = clamp(panY, -limitY, limitY);
      render(1);
      start();
    }

    function paused() {
      return (
        externalPause ||
        blocked ||
        !intersecting ||
        document.hidden ||
        destroyed
      );
    }

    function checkBlocking() {
      if (destroyed) return;
      blocked = !host.isConnected;
      for (
        let element = host;
        element && !blocked;
        element = element.parentElement
      ) {
        blocked =
          element.hidden ||
          element.inert ||
          element.getAttribute("aria-hidden") === "true";
      }
      if (!blocked) {
        blocked = Array.from(
          document.querySelectorAll(
            'dialog[open], [role="dialog"][aria-modal="true"]',
          ),
        ).some((dialog) => {
          if (
            host.contains(dialog) ||
            dialog.hidden ||
            dialog.getAttribute("aria-hidden") === "true"
          )
            return false;
          const style = getComputedStyle(dialog);
          return style.display !== "none" && style.visibility !== "hidden";
        });
      }
      if (paused()) stop();
      else start();
    }

    function stop() {
      cancelAnimationFrame(frame);
      frame = 0;
      previousTime = 0;
      velocityX = velocityY = 0;
      if (pointer) finishPointer(true);
    }

    function start() {
      if (frame || paused() || !width || !height) return;
      frame = requestAnimationFrame(tick);
    }

    function integrateAxis(value, velocity, limit, dt) {
      const anchor = clamp(value, -limit, limit);
      if (Math.abs(value - anchor) > 0.05) {
        velocity += ((anchor - value) * 145 - velocity * 24) * dt;
      } else {
        velocity *= Math.exp(-5.5 * dt);
      }
      value += velocity * dt;
      if (Math.abs(velocity) < 0.35 && Math.abs(value - anchor) < 0.15)
        return [anchor, 0];
      return [value, velocity];
    }

    function tick(time) {
      frame = 0;
      if (paused()) return;
      const dt = Math.min(
        0.032,
        previousTime ? (time - previousTime) / 1000 : 1 / 60,
      );
      previousTime = time;
      runningTime += dt;
      if (!pointer) {
        [panX, velocityX] = integrateAxis(panX, velocityX, limitX, dt);
        [panY, velocityY] = integrateAxis(panY, velocityY, limitY, dt);
      }
      const ease = motion.matches ? 1 : 1 - Math.exp(-18 * dt);
      lens += ((pointer ? 1 : 0) - lens) * ease;
      render(ease);
      const unsettled =
        lens > 0.002 ||
        Math.abs(velocityX) > 0.1 ||
        Math.abs(velocityY) > 0.1 ||
        Math.abs(panX) > limitX + 0.1 ||
        Math.abs(panY) > limitY + 0.1;
      if (!motion.matches || pointer || unsettled)
        frame = requestAnimationFrame(tick);
    }

    function render(ease) {
      const drift = motion.matches
        ? 0
        : (1 - lens * 0.8) * Math.min(2.2, diameter * 0.022);
      const influence = diameter * 1.65;
      for (const node of nodes) {
        const floatX = Math.sin(runningTime * 0.43 + node.phase) * drift;
        const floatY = Math.cos(runningTime * 0.35 + node.phase * 1.31) * drift;
        const x = width / 2 + node.x + panX + floatX;
        const y = height / 2 + node.y + panY + floatY;
        const padding = diameter * 0.7;
        const visible =
          x > -padding &&
          x < width + padding &&
          y > -padding &&
          y < height + padding;
        const changedVisibility = visible !== node.visible;
        if (changedVisibility) {
          node.visible = visible;
          node.button.classList.toggle("is-in-view", visible);
        }
        // Retain real buttons for assistive technology without allocating a GPU
        // layer or writing new styles every frame for every saved item.
        if (!visible && !changedVisibility && node.transform) continue;
        const proximity = Math.max(
          0,
          1 - Math.hypot(x - pointerX, y - pointerY) / influence,
        );
        const target = 1 + lens * (-0.085 + 0.245 * proximity * proximity);
        const pressed =
          pointer && !pointer.dragged && pointer.node === node ? 0.965 : 1;
        node.scale += (target * pressed - node.scale) * ease;
        const transform = `translate3d(${(x - diameter / 2).toFixed(2)}px,${(y - diameter / 2).toFixed(2)}px,0) scale(${node.scale.toFixed(4)})`;
        if (node.transform !== transform) {
          node.button.style.transform = transform;
          node.transform = transform;
        }
      }
    }

    function findNode(target) {
      const button =
        target instanceof Element ? target.closest(".orbit-item") : null;
      return button && host.contains(button)
        ? nodes[Number(button.dataset.orbitIndex)]
        : null;
    }

    function pointerDown(event) {
      if (
        paused() ||
        pointer ||
        !event.isPrimary ||
        (event.pointerType === "mouse" && event.button !== 0)
      )
        return;
      event.preventDefault();
      rect = host.getBoundingClientRect();
      pointerX = event.clientX - rect.left;
      pointerY = event.clientY - rect.top;
      const node = findNode(event.target);
      pointer = {
        id: event.pointerId,
        node,
        startX: event.clientX,
        startY: event.clientY,
        baseX: panX,
        baseY: panY,
        lastX: panX,
        lastY: panY,
        lastTime: performance.now(),
        dragged: false,
      };
      focusedNode = null;
      velocityX = velocityY = 0;
      try {
        host.setPointerCapture(event.pointerId);
      } catch (_) {
        /* pointer can already be released */
      }
      start();
    }

    function pointerMove(event) {
      if (!pointer || event.pointerId !== pointer.id) return;
      event.preventDefault();
      pointerX = event.clientX - rect.left;
      pointerY = event.clientY - rect.top;
      const dx = event.clientX - pointer.startX;
      const dy = event.clientY - pointer.startY;
      if (Math.hypot(dx, dy) > 7) pointer.dragged = true;
      if (!pointer.dragged) return;
      host.classList.add("is-dragging");
      const now = performance.now();
      const dt = Math.max(0.008, (now - pointer.lastTime) / 1000);
      panX = rubberBand(pointer.baseX + dx, limitX, width);
      panY = rubberBand(pointer.baseY + dy, limitY, height);
      velocityX = clamp(
        0.65 * velocityX + (0.35 * (panX - pointer.lastX)) / dt,
        -1100,
        1100,
      );
      velocityY = clamp(
        0.65 * velocityY + (0.35 * (panY - pointer.lastY)) / dt,
        -1100,
        1100,
      );
      pointer.lastX = panX;
      pointer.lastY = panY;
      pointer.lastTime = now;
      start();
    }

    function finishPointer(cancelled, event) {
      if (!pointer || (event && event.pointerId !== pointer.id)) return;
      const current = pointer;
      pointer = null;
      host.classList.remove("is-dragging");
      try {
        if (host.hasPointerCapture(current.id))
          host.releasePointerCapture(current.id);
      } catch (_) {
        /* no active capture */
      }
      ignoreClickUntil = performance.now() + 450;
      if (cancelled || performance.now() - current.lastTime > 100)
        velocityX = velocityY = 0;
      if (motion.matches) {
        panX = clamp(panX, -limitX, limitX);
        panY = clamp(panY, -limitY, limitY);
        velocityX = velocityY = lens = 0;
        render(1);
      }
      if (
        !cancelled &&
        !current.dragged &&
        current.node &&
        typeof onOpen === "function"
      ) {
        onOpen(current.node.item.id, current.node.button);
      }
      start();
    }

    function keepVisible(node) {
      if (!node) return;
      const margin = diameter * 0.6 + 12;
      const x = width / 2 + node.x + panX;
      const y = height / 2 + node.y + panY;
      let nextX = panX,
        nextY = panY;
      if (x < margin) nextX += margin - x;
      else if (x > width - margin) nextX -= x - width + margin;
      if (y < margin) nextY += margin - y;
      else if (y > height - margin) nextY -= y - height + margin;
      panX = clamp(nextX, -limitX, limitX);
      panY = clamp(nextY, -limitY, limitY);
      velocityX = velocityY = 0;
      render(1);
    }

    host.addEventListener("pointerdown", pointerDown, { signal });
    host.addEventListener("pointermove", pointerMove, { signal });
    host.addEventListener("pointerup", (event) => finishPointer(false, event), {
      signal,
    });
    host.addEventListener(
      "pointercancel",
      (event) => finishPointer(true, event),
      { signal },
    );
    host.addEventListener(
      "lostpointercapture",
      (event) => finishPointer(true, event),
      { signal },
    );
    host.addEventListener("contextmenu", (event) => event.preventDefault(), {
      signal,
    });
    host.addEventListener("dragstart", (event) => event.preventDefault(), {
      signal,
    });
    host.addEventListener(
      "click",
      (event) => {
        const node = findNode(event.target);
        if (!node) return;
        event.preventDefault();
        if (
          paused() ||
          event.detail > 0 ||
          performance.now() < ignoreClickUntil
        )
          return;
        if (typeof onOpen === "function") onOpen(node.item.id, node.button);
      },
      { signal },
    );
    host.addEventListener(
      "focusin",
      (event) => {
        focusedNode = findNode(event.target);
        nodes.forEach((node) => {
          node.button.tabIndex = node === focusedNode ? 0 : -1;
        });
        keepVisible(focusedNode);
      },
      { signal },
    );
    host.addEventListener(
      "focusout",
      (event) => {
        if (!host.contains(event.relatedTarget)) focusedNode = null;
      },
      { signal },
    );
    host.addEventListener(
      "keydown",
      (event) => {
        const node = findNode(event.target);
        if (!node) return;
        const directions = {
          ArrowLeft: [-1, 0],
          ArrowRight: [1, 0],
          ArrowUp: [0, -1],
          ArrowDown: [0, 1],
        };
        if (event.key === "Home") {
          event.preventDefault();
          nodes[0]?.button.focus({ preventScroll: true });
        } else if (event.key === "End") {
          event.preventDefault();
          nodes[nodes.length - 1]?.button.focus({ preventScroll: true });
        } else if (directions[event.key]) {
          event.preventDefault();
          const [dx, dy] = directions[event.key];
          const next = nodes
            .filter(
              (other) =>
                other !== node &&
                (other.x - node.x) * dx + (other.y - node.y) * dy > 1,
            )
            .map((other) => {
              const along = (other.x - node.x) * dx + (other.y - node.y) * dy;
              const across = Math.abs(
                (other.x - node.x) * dy - (other.y - node.y) * dx,
              );
              return { node: other, score: along + across * 2.5 };
            })
            .sort((a, b) => a.score - b.score)[0];
          next?.node.button.focus({ preventScroll: true });
        }
      },
      { signal },
    );

    const resizeObserver = new ResizeObserver(layout);
    resizeObserver.observe(host);
    const intersectionObserver = new IntersectionObserver(
      (entries) => {
        intersecting = entries[0].isIntersecting;
        if (paused()) stop();
        else start();
      },
      { threshold: 0.02 },
    );
    intersectionObserver.observe(host);
    const mutationObserver = new MutationObserver(checkBlocking);
    mutationObserver.observe(document.documentElement, {
      attributes: true,
      subtree: true,
      childList: true,
      attributeFilter: ["inert", "hidden", "aria-hidden", "open", "aria-modal"],
    });
    document.addEventListener("visibilitychange", checkBlocking, { signal });
    motion.addEventListener(
      "change",
      () => {
        velocityX = velocityY = 0;
        lens = pointer ? 1 : 0;
        if (motion.matches && !pointer) {
          panX = clamp(panX, -limitX, limitX);
          panY = clamp(panY, -limitY, limitY);
        }
        render(1);
        start();
      },
      { signal },
    );
    layout();
    checkBlocking();

    return {
      pause() {
        externalPause = true;
        stop();
      },
      resume() {
        externalPause = false;
        checkBlocking();
      },
      reset() {
        if (pointer) finishPointer(true);
        panX = panY = velocityX = velocityY = lens = 0;
        render(1);
        start();
      },
      destroy() {
        if (destroyed) return;
        destroyed = true;
        stop();
        controller.abort();
        resizeObserver.disconnect();
        intersectionObserver.disconnect();
        mutationObserver.disconnect();
        nodes.forEach((node) => node.button.remove());
        host.classList.remove("storyge-orbit", "is-dragging");
        host.style.removeProperty("--orbit-size");
        if (originalLabel === null) host.removeAttribute("aria-label");
        else host.setAttribute("aria-label", originalLabel);
        if (originalRole === null) host.removeAttribute("role");
        else host.setAttribute("role", originalRole);
      },
    };
  };
})();
