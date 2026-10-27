(() => {
  const config = window.__SITE__ || {};
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  function track(name, detail = {}) {
    try {
      if (Array.isArray(window.dataLayer)) {
        window.dataLayer.push({ event: name, ...detail });
      }
      if (typeof window.gtag === 'function') {
        window.gtag('event', name, detail);
      }
    } catch (_) {
      /* analytics is optional */
    }
    document.dispatchEvent(new CustomEvent('site:track', { detail: { name, ...detail } }));
  }

  /* Mobile menu */
  const menuToggle = $('#menu-toggle');
  const mobileMenu = $('#mobile-menu');
  if (menuToggle && mobileMenu) {
    const setOpen = (open) => {
      mobileMenu.classList.toggle('hidden', !open);
      menuToggle.setAttribute('aria-expanded', String(open));
      const label = open ? menuToggle.dataset.labelClose : menuToggle.dataset.labelOpen;
      if (label) menuToggle.setAttribute('aria-label', label);
    };
    menuToggle.addEventListener('click', () => {
      setOpen(menuToggle.getAttribute('aria-expanded') !== 'true');
    });
    mobileMenu.addEventListener('click', (event) => {
      if (event.target.closest('a')) setOpen(false);
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && menuToggle.getAttribute('aria-expanded') === 'true') {
        setOpen(false);
        menuToggle.focus();
      }
    });
    window.addEventListener('resize', () => {
      if (window.innerWidth >= 1280) setOpen(false);
    });
  }

  /* Header shadow on scroll */
  const header = $('#site-header');
  if (header) {
    const onScroll = () => {
      header.classList.toggle('shadow-[0_6px_24px_rgba(9,12,13,0.08)]', window.scrollY > 8);
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
  }

  /* FAQ accordion: keep one answer open at a time */
  const faqItems = $$('details.faq-item');
  faqItems.forEach((item) => {
    item.addEventListener('toggle', () => {
      if (!item.open) return;
      faqItems.forEach((other) => {
        if (other !== item) other.open = false;
      });
      track('faq_open', { question: item.querySelector('summary')?.textContent?.trim() });
    });
  });

  /* OS detection for download CTAs */
  function detectOS() {
    const ua = navigator.userAgent || '';
    const platform = navigator.platform || '';
    if (/Android/i.test(ua)) return 'android';
    if (/iPhone|iPad|iPod/i.test(ua) || (platform === 'MacIntel' && navigator.maxTouchPoints > 1)) return 'ios';
    if (/Win/i.test(platform) || /Windows/i.test(ua)) return 'win';
    if (/Mac/i.test(platform) || /Mac OS X/i.test(ua)) return 'mac';
    if (/Linux|X11/i.test(platform) || /Linux/i.test(ua)) return 'linux';
    return '';
  }
  const os = detectOS();
  document.documentElement.dataset.detectedOs = os;

  $$('[data-os-card]').forEach((card) => {
    card.classList.toggle('is-detected', card.dataset.osCard === os);
  });

  const detectedBanner = $('[data-os-banner]');
  if (detectedBanner && os) {
    const label = detectedBanner.dataset[`label${os.charAt(0).toUpperCase()}${os.slice(1)}`];
    if (label) {
      detectedBanner.textContent = label;
      detectedBanner.hidden = false;
    }
  }

  /* Video showcase */
  $$('[data-video-demo]').forEach((shell) => {
    const video = $('video', shell);
    const poster = $('[data-video-poster]', shell);
    if (!video) return;
    const start = () => {
      if (poster) poster.classList.add('hidden');
      video.controls = true;
      video.play().catch(() => {
        if (poster) poster.classList.remove('hidden');
      });
      track('video_play');
    };
    shell.addEventListener('click', (event) => {
      if (event.target.closest('a, button[data-video-cta]')) return;
      if (!video.controls) start();
    });
    video.addEventListener('pause', () => {
      if (video.currentTime === 0 && video.paused) {
        if (poster) poster.classList.remove('hidden');
      }
    });
  });

  /* Feedback form */
  const form = $('#feedback-form');
  if (form) {
    const status = $('#feedback-status');
    const params = new URLSearchParams(window.location.search);
    const typeMap = { license: 'license', feature: 'feature', suggestion: 'feature', bug: 'bug', problem: 'bug', partnership: 'partnership' };
    const presetType = typeMap[params.get('type') || ''];
    if (presetType) {
      const radio = form.querySelector(`input[name="type"][value="${presetType}"]`);
      if (radio) radio.checked = true;
    }
    const plan = params.get('plan') || '';
    if (plan) {
      const suffix = config.lang === 'en' ? 'En' : '';
      const label = form.dataset[`plan${plan.charAt(0).toUpperCase()}${plan.slice(1)}${suffix}`];
      const message = $('#fb-message');
      if (label && message && !message.value) {
        message.value = config.lang === 'en' ? `I have a licensing question about the ${label} plan: ` : `我想咨询「${label}」授权：`;
      }
    }
    const success = $('#feedback-success');
    const submit = $('button[type="submit"]', form);
    const t = {
      required: form.dataset.msgRequired || 'Please fill in the required fields.',
      short: form.dataset.msgShort || 'Please write a little more.',
      long: form.dataset.msgLong || 'Please keep it shorter.',
      consent: form.dataset.msgConsent || 'Please accept the privacy policy first.',
      error: form.dataset.msgError || 'Could not send. Please try again later.',
      rateLimited: form.dataset.msgRateLimited || 'Too many submissions. Please try again later.',
      unavailable: form.dataset.msgUnavailable || 'The feedback endpoint is not configured.',
      submitting: form.dataset.msgSubmitting || 'Sending…',
      submit: form.dataset.msgSubmit || 'Send feedback',
    };

    const setError = (field, visible) => {
      const wrap = field.closest('[data-field]');
      if (wrap) wrap.classList.toggle('field-invalid', visible);
    };

    const validate = () => {
      let firstInvalid = null;
      const message = $('#fb-message');
      const type = form.querySelector('input[name="type"]:checked');
      const consent = $('#fb-consent');
      if (!type) {
        firstInvalid = firstInvalid || $('[data-field="type"]');
        $('[data-field="type"]')?.classList.add('field-invalid');
      } else {
        $('[data-field="type"]')?.classList.remove('field-invalid');
      }
      const len = message.value.trim().length;
      const messageInvalid = len < 20 || len > 2000;
      setError(message, messageInvalid);
      if (messageInvalid && !firstInvalid) firstInvalid = message;
      const consentInvalid = !consent.checked;
      setError(consent, consentInvalid);
      if (consentInvalid && !firstInvalid) firstInvalid = consent;
      return firstInvalid;
    };

    $$('input, textarea, select', form).forEach((field) => {
      field.addEventListener('input', () => {
        const wrap = field.closest('[data-field]');
        if (wrap?.classList.contains('field-invalid')) validate();
      });
    });

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const invalid = validate();
      if (invalid) {
        invalid.focus?.();
        if (status) status.textContent = t.required;
        return;
      }

      const data = new FormData(form);
      if (String(data.get('website') || '').trim()) return; // honeypot

      const payload = {
        type: data.get('type'),
        message: String(data.get('message') || '').trim(),
        contact: String(data.get('contact') || '').trim(),
        os: String(data.get('os') || ''),
        appVersion: String(data.get('appVersion') || ''),
        page: window.location.href,
        lang: config.lang || document.documentElement.lang,
        website: '',
      };

      if (!config.feedbackEndpoint) {
        if (status) status.textContent = t.unavailable;
        return;
      }

      submit.disabled = true;
      const original = submit.textContent;
      submit.textContent = t.submitting;
      if (status) status.textContent = '';

      try {
        const res = await fetch(config.feedbackEndpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        if (res.status === 429) throw new Error('rate-limited');
        if (!res.ok) throw new Error('failed');
        track('feedback_submit', { type: payload.type });
        form.hidden = true;
        if (success) {
          success.hidden = false;
          success.focus?.();
          success.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      } catch (error) {
        if (status) {
          status.textContent = error.message === 'rate-limited' ? t.rateLimited : t.error;
        }
        submit.disabled = false;
        submit.textContent = original;
      }
    });
  }

  /* Track outbound download clicks */
  $$('a[href]').forEach((link) => {
    link.addEventListener('click', () => {
      const href = link.getAttribute('href') || '';
      if (/\.(exe|dmg|zip|AppImage|deb)(\?|$)/i.test(href)) {
        track('download_click', { file: href.split('/').pop() });
      }
    });
  });
})();
