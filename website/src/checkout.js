(function () {
  'use strict';

  var DATA = window.__CHECKOUT__ || { plans: [], portalUrl: '' };
  var PLANS = {};
  (DATA.plans || []).forEach(function (plan) { PLANS[plan.id] = plan; });

  var EMAIL_KEY = 'wmc_checkout_email';
  var LAST_KEY = 'wmc_checkout_last';
  var STATUS_LABELS = {
    pending: '等待支付…',
    paid: '支付成功，正在发放授权…',
    fulfilled: '支付成功，授权已发放',
    fulfill_failed: '支付成功，授权发放稍后完成',
    refund_pending: '退款处理中…',
    refunded: '订单已退款',
    closed: '订单已关闭或超时',
  };

  function $(id) { return document.getElementById(id); }
  function text(el, value) { if (el) el.textContent = value == null ? '' : String(value); }
  function show(el, visible) { if (el) el.hidden = !visible; }

  function planFromUrl() {
    try {
      var plan = new URL(window.location.href).searchParams.get('plan');
      if (plan && PLANS[plan]) return plan;
    } catch (e) { /* ignore */ }
    return PLANS.monthly ? 'monthly' : Object.keys(PLANS)[0];
  }

  function validEmail(value) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim());
  }

  function money(plan) {
    if (!plan) return '';
    return '¥' + plan.price;
  }

  function api(path, options) {
    options = options || {};
    options.headers = Object.assign({ 'Content-Type': 'application/json' }, options.headers || {});
    return fetch(path, options).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (body) {
        return { status: res.status, okay: res.ok, body: body };
      });
    });
  }

  function setStatus(el, message, tone) {
    if (!el) return;
    el.textContent = message;
    el.className = 'font-body-sm text-body-sm ' + (tone === 'error' ? 'text-error' : tone === 'success' ? 'text-status-success' : tone === 'warning' ? 'text-status-warning' : 'text-on-surface-variant');
  }

  function renderQr(container, codeUrl) {
    if (!container) return;
    container.innerHTML = '';
    if (!codeUrl || typeof window.qrcode !== 'function') {
      text(container, '二维码加载失败，请刷新页面重试。');
      return;
    }
    try {
      var qr = window.qrcode(0, 'M');
      qr.addData(codeUrl);
      qr.make();
      container.innerHTML = qr.createSvgTag({ cellSize: 5, margin: 8 });
    } catch (e) {
      text(container, '二维码生成失败，请刷新页面重试。');
    }
  }

  function rememberLast(orderId, token, plan) {
    try {
      sessionStorage.setItem(LAST_KEY, JSON.stringify({ order: orderId, token: token, plan: plan }));
      localStorage.setItem(EMAIL_KEY, $('co-email') ? $('co-email').value.trim() : '');
    } catch (e) { /* ignore */ }
  }

  function redirectToReturn(url) {
    if (url) window.location.href = url;
  }

  /* ------------------------------------------------------------ Checkout */

  function mountCheckout() {
    if (!$('checkout-form')) return;

    var form = $('checkout-form');
    var emailInput = $('co-email');
    var field = emailInput ? emailInput.closest('[data-field]') : null;
    var submit = $('co-submit');
    var submitLabel = $('co-submit-label');
    var statusEl = $('co-status');
    var healthEl = $('co-health');
    var wechatPanel = $('checkout-wechat');
    var payPanel = $('checkout-pay');
    var qrEl = $('co-qr');
    var orderRef = $('co-order-ref');
    var payState = $('co-pay-state');
    var checkBtn = $('co-check');
    var mockBtn = $('co-mock-pay');
    var openReturn = $('co-open-return');
    var planButtons = Array.prototype.slice.call(document.querySelectorAll('[data-plan]'));
    var current = planFromUrl();
    var active = null;
    var pollTimer = null;
    var pollDeadline = 0;

    function selectPlan(id) {
      if (!PLANS[id]) return;
      current = id;
      var plan = PLANS[id];
      planButtons.forEach(function (btn) {
        var on = btn.getAttribute('data-plan') === id;
        btn.setAttribute('aria-pressed', on ? 'true' : 'false');
        btn.classList.toggle('border-primary', on);
        btn.classList.toggle('ring-2', on);
        btn.classList.toggle('ring-gold-accent/50', on);
        btn.classList.toggle('border-border-light', !on);
      });
      text($('co-plan-name'), plan.label);
      text($('co-plan-note'), plan.tagline);
      text($('co-price'), money(plan));
      text($('co-unit'), plan.unit);
      text(submitLabel, '微信支付 ' + money(plan));
    }

    planButtons.forEach(function (btn) {
      btn.addEventListener('click', function () { selectPlan(btn.getAttribute('data-plan')); });
      btn.addEventListener('keydown', function (event) {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          selectPlan(btn.getAttribute('data-plan'));
        }
      });
    });
    selectPlan(current);

    try {
      var saved = localStorage.getItem(EMAIL_KEY);
      if (saved) emailInput.value = saved;
    } catch (e) { /* ignore */ }

    if (emailInput) {
      emailInput.addEventListener('input', function () {
        if (field) field.classList.remove('field-invalid');
      });
    }

    api('/api/checkout/health').then(function (res) {
      var health = res.body || {};
      if (!health.wechat_configured) {
        show(healthEl, true);
        text(healthEl, '在线支付暂未开放，请稍后再试，或通过反馈表单联系我们。');
        if (submit) submit.disabled = true;
      }
    }).catch(function () { /* ignore: form still validates server-side */ });

    function stopPolling() {
      if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
    }

    function applyStatus(order) {
      var label = STATUS_LABELS[order.status] || order.status;
      if (payState) {
        text(payState, label);
        payState.className = 'mt-3 font-label-capsule text-label-capsule ' +
          (order.status === 'fulfilled' ? 'text-status-success' : order.status === 'refunded' || order.status === 'closed' ? 'text-on-surface-variant' : 'text-primary');
      }
      if (order.status === 'fulfilled' || order.status === 'paid' || order.status === 'refunded') {
        show(openReturn, true);
        if (checkBtn) checkBtn.hidden = true;
        if (order.status === 'fulfilled') {
          stopPolling();
          if (openReturn) setTimeout(function () { redirectToReturn(openReturn.getAttribute('href')); }, 1200);
        }
      }
    }

    function pollStatus() {
      if (!active) return;
      if (document.hidden) return;
      api('/api/checkout/orders/' + encodeURIComponent(active.order) + '?token=' + encodeURIComponent(active.token))
        .then(function (res) {
          if (res.okay && res.body.order) applyStatus(res.body.order);
        })
        .catch(function () { /* keep polling */ });
      if (Date.now() > pollDeadline) stopPolling();
    }

    function startPolling(orderId, token) {
      stopPolling();
      active = { order: orderId, token: token };
      pollDeadline = Date.now() + 2 * 60 * 1000;
      pollTimer = setInterval(pollStatus, 3000);
      pollStatus();
    }

    function startMockPay(orderId, token) {
      api('/api/checkout/admin/mock-pay', {
        method: 'POST',
        body: JSON.stringify({ order_id: orderId, token: token }),
      }).then(function (res) {
        if (res.body && res.body.order) applyStatus(res.body.order);
        else if (res.body && res.body.error) text(payState, '模拟支付失败：' + res.body.error);
      }).catch(function () { text(payState, '模拟支付请求失败。'); });
    }

    form.addEventListener('submit', function (event) {
      event.preventDefault();
      if (!validEmail(emailInput.value)) {
        if (field) field.classList.add('field-invalid');
        emailInput.focus();
        return;
      }
      if (field) field.classList.remove('field-invalid');
      if (submit) submit.disabled = true;
      setStatus(statusEl, '正在创建订单…');

      api('/api/checkout/orders', {
        method: 'POST',
        body: JSON.stringify({ plan: current, email: emailInput.value.trim() }),
      }).then(function (res) {
        var body = res.body || {};
        if (body.wechat_browser) {
          show(wechatPanel, true);
          show(payPanel, false);
          setStatus(statusEl, body.message || '请在系统浏览器中打开本页后支付。', 'warning');
          return;
        }
        if (!res.okay || !body.order_id) {
          var message = body.message || {
            'invalid-email': '邮箱格式不正确。',
            'invalid-plan': '套餐无效，请重新选择。',
            'rate-limited': '操作过于频繁，请稍后再试。',
            'payment-unavailable': '在线支付暂未开放。',
          }[body.error] || '创建订单失败，请稍后再试。';
          setStatus(statusEl, message, 'error');
          return;
        }

        rememberLast(body.order_id, body.token, body.plan);
        setStatus(statusEl, '');

        if (body.channel === 'h5' && body.h5_url) {
          window.location.href = body.h5_url;
          return;
        }

        show(wechatPanel, false);
        show(payPanel, true);
        text(orderRef, body.order_id);
        renderQr(qrEl, body.code_url);
        openReturn.setAttribute('href', body.return_url || '/checkout/return/');
        var isMock = /^mock:\/\//.test(String(body.code_url || ''));
        show(mockBtn, isMock);
        if (isMock) {
          text(payState, '本地模拟模式：点击下方「模拟支付」完成流程。');
        }
        startPolling(body.order_id, body.token);
        if (checkBtn) {
          checkBtn.onclick = function () { pollStatus(); };
        }
        if (mockBtn) {
          mockBtn.onclick = function () { startMockPay(body.order_id, body.token); };
        }
        if (payPanel.scrollIntoView) payPanel.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }).catch(function () {
        setStatus(statusEl, '网络异常，请稍后再试。', 'error');
      }).then(function () {
        if (!active) submit.disabled = false;
        else submit.disabled = true;
      });
    });

    var copyBtn = $('co-copy-link');
    if (copyBtn) {
      copyBtn.addEventListener('click', function () {
        var link = window.location.href;
        var done = function () { text(copyBtn, '已复制链接'); setTimeout(function () { text(copyBtn, '复制本页链接'); }, 2000); };
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(link).then(done, done);
        } else {
          var input = document.createElement('input');
          input.value = link;
          document.body.appendChild(input);
          input.select();
          try { document.execCommand('copy'); } catch (e) { /* ignore */ }
          document.body.removeChild(input);
          done();
        }
      });
    }

    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) pollStatus();
    });
  }

  /* -------------------------------------------------------------- Return */

  function mountReturn() {
    if (!$('co-return-title')) return;

    var params = new URLSearchParams(window.location.search);
    var saved = null;
    try { saved = JSON.parse(sessionStorage.getItem(LAST_KEY) || 'null'); } catch (e) { saved = null; }
    var orderId = params.get('order') || (saved && saved.order);
    var token = params.get('token') || (saved && saved.token);

    var iconEl = $('co-return-icon');
    var titleEl = $('co-return-title');
    var bodyEl = $('co-return-body');
    var metaEl = $('co-return-meta');
    var openApp = $('co-open-app');
    var refresh = $('co-refresh');
    var timer = null;
    var deadline = Date.now() + 5 * 60 * 1000;

    function setIcon(name, cls) {
      if (!iconEl) return;
      iconEl.className = 'mx-auto flex h-14 w-14 items-center justify-center rounded-full ' + cls;
      iconEl.innerHTML = '<span class="material-symbols-outlined text-[30px]">' + name + '</span>';
    }

    function finish(kind, title, body, meta) {
      if (timer) { clearInterval(timer); timer = null; }
      titleEl.textContent = title;
      bodyEl.textContent = body;
      if (meta) {
        metaEl.textContent = meta;
        show(metaEl, true);
      } else {
        show(metaEl, false);
      }
      if (kind === 'success') setIcon('check_circle', 'bg-status-success/10 text-status-success');
      else if (kind === 'warning') setIcon('info', 'bg-status-warning/10 text-status-warning');
      else setIcon('error', 'bg-error/10 text-error');
      if (kind === 'success' && openApp) {
        // Keep the download link as the primary next step.
        openApp.textContent = '';
        openApp.className = 'inline-flex items-center gap-2 rounded-full bg-gold-accent px-5 py-2.5 font-label-capsule text-label-capsule text-canvas-dark';
        openApp.innerHTML = '<span class="material-symbols-outlined text-[18px]">download</span>下载桌面端并激活';
      }
    }

    function handle(order) {
      var validUntil = order.valid_until ? String(order.valid_until).slice(0, 10) : '';
      if (order.status === 'fulfilled') {
        finish(
          'success',
          '支付成功，授权已发放',
          '授权码已发送到 ' + (order.email_masked || '你的邮箱') + '。打开桌面端，用同一邮箱登录即可自动激活；也可以在「账号与授权」中直接粘贴授权码。',
          validUntil ? '有效期至 ' + validUntil : '',
        );
      } else if (order.status === 'paid' || order.status === 'fulfilling') {
        titleEl.textContent = '支付成功，正在发放授权…';
        bodyEl.textContent = '通常几秒内完成，请不要关闭页面。';
        setIcon('hourglass_top', 'bg-surface-container-low text-primary');
      } else if (order.status === 'refunded') {
        finish('warning', '订单已退款', '退款已原路退回微信支付账户，到账时间以微信通知为准。', '');
      } else if (order.status === 'closed') {
        finish('warning', '订单已关闭', '该订单长时间未支付，已自动关闭。如需购买请重新下单。', '');
      } else if (order.status === 'fulfill_failed') {
        finish('warning', '支付成功，授权发放处理中', '授权发放暂时失败，我们正在自动重试。如果长时间未收到授权码，请通过反馈表单联系并提供订单号。', '订单号 ' + orderId);
      } else {
        titleEl.textContent = '等待支付结果…';
        bodyEl.textContent = '如果你已经完成支付，授权通常会在几秒内自动发放。';
        setIcon('hourglass_top', 'bg-surface-container-low text-on-surface-variant');
      }
    }

    function poll() {
      if (!orderId || !token) {
        finish('warning', '缺少订单信息', '请从支付页面重新进入，或通过反馈表单联系我们并提供订单号。', '');
        return;
      }
      if (document.hidden) return;
      api('/api/checkout/orders/' + encodeURIComponent(orderId) + '?token=' + encodeURIComponent(token))
        .then(function (res) {
          if (res.okay && res.body.order) {
            handle(res.body.order);
          } else if (res.status === 404) {
            finish('warning', '找不到该订单', '订单链接可能已失效。请通过反馈表单联系我们并提供订单号。', '');
          }
        })
        .catch(function () { /* keep polling */ });
      if (Date.now() > deadline) {
        if (timer) { clearInterval(timer); timer = null; }
        if (titleEl.textContent.indexOf('支付成功') < 0 && titleEl.textContent.indexOf('退款') < 0) {
          titleEl.textContent = '仍在等待支付结果';
          bodyEl.textContent = '订单还在处理中。请稍后点击「刷新状态」，或检查邮箱是否已收到授权码。';
        }
      }
    }

    if (refresh) {
      refresh.addEventListener('click', function () {
        deadline = Date.now() + 2 * 60 * 1000;
        if (!timer) timer = setInterval(poll, 3000);
        poll();
      });
    }

    poll();
    timer = setInterval(poll, 3000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { mountCheckout(); mountReturn(); });
  } else {
    mountCheckout();
    mountReturn();
  }
})();
