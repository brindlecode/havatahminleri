      const REPO_OWNER = 'ilkukaya';
      const REPO_NAME = 'havatahminleri';
      const CONFIG_PATH = 'src/data/site-config.json';
      const WORKFLOW_FILE = 'scheduled-build.yml';
      const WORKFLOW_BRANCH = 'claude/weather-forecast-site-JpQxB';
      const ADMIN_USERS = ['ilkukaya'];
      const TOKEN_KEY = 'admin_gh_token';

      let currentToken = null;
      let currentConfig = null;
      let currentConfigSha = null;

      function sanitizeText(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
      }

      async function ghApi(path, options = {}) {
        const res = await fetch(`https://api.github.com${path}`, {
          ...options,
          headers: {
            'Authorization': 'token ' + currentToken,
            'Accept': 'application/vnd.github.v3+json',
            ...(options.headers || {}),
            ...(options.body ? { 'Content-Type': 'application/json' } : {})
          }
        });
        if (!res.ok) throw new Error(`GitHub API ${res.status}: ${await res.text()}`);
        return res.status === 204 ? null : res.json();
      }

      function checkAuth() {
        const token = sessionStorage.getItem(TOKEN_KEY);
        if (token) validateToken(token);
      }

      async function validateToken(token) {
        if (!token || token.length < 10) {
          sessionStorage.removeItem(TOKEN_KEY);
          return;
        }
        try {
          const res = await fetch('https://api.github.com/user', {
            headers: { 'Authorization': 'token ' + token }
          });
          if (res.ok) {
            const user = await res.json();
            if (ADMIN_USERS.includes(user.login)) {
              currentToken = token;
              showAdmin(user);
              return;
            }
            alert('Bu GitHub hesabının admin yetkisi bulunmamaktadır.');
          }
          sessionStorage.removeItem(TOKEN_KEY);
        } catch {
          sessionStorage.removeItem(TOKEN_KEY);
        }
      }

      // ── Hash-based routing ──
      function switchTab(tabId) {
        document.querySelectorAll('.nav-item').forEach(btn => {
          btn.classList.toggle('active', btn.dataset.tab === tabId);
        });
        document.querySelectorAll('.tab-panel').forEach(panel => {
          panel.classList.toggle('active', panel.id === 'panel-' + tabId);
        });
        window.location.hash = tabId;
        closeMobileSidebar();
      }

      function getTabFromHash() {
        const hash = window.location.hash.slice(1);
        const valid = ['overview', 'build', 'analytics', 'seo', 'api'];
        return valid.includes(hash) ? hash : 'overview';
      }

      function closeMobileSidebar() {
        document.getElementById('sidebar').classList.remove('open');
        document.getElementById('sidebar-overlay').classList.remove('open');
      }

      function setSaveButtonsEnabled(enabled) {
        ['save-analytics-btn', 'save-seo-btn', 'save-ads-btn'].forEach(id => {
          const btn = document.getElementById(id);
          if (btn) btn.disabled = !enabled;
        });
      }

      function showAdmin(user) {
        document.getElementById('login-screen').classList.add('hidden');
        document.getElementById('top-header').classList.remove('hidden');
        document.getElementById('admin-shell').classList.remove('hidden');

        // Header user info
        const headerUser = document.getElementById('header-user');
        headerUser.innerHTML = '';
        const pill = document.createElement('div');
        pill.className = 'user-pill';
        const avatar = document.createElement('img');
        avatar.src = user.avatar_url;
        avatar.alt = sanitizeText(user.login);
        avatar.width = 26;
        avatar.height = 26;
        const uname = document.createElement('span');
        uname.textContent = user.login;
        pill.appendChild(avatar);
        pill.appendChild(uname);
        headerUser.appendChild(pill);

        const logoutBtn = document.createElement('button');
        logoutBtn.className = 'logout-btn';
        logoutBtn.textContent = 'Çıkış';
        logoutBtn.addEventListener('click', () => {
          sessionStorage.removeItem(TOKEN_KEY);
          location.reload();
        });
        headerUser.appendChild(logoutBtn);

        // Sidebar navigation
        document.querySelectorAll('.nav-item').forEach(btn => {
          btn.addEventListener('click', () => switchTab(btn.dataset.tab));
        });

        // Mobile hamburger
        document.getElementById('hamburger-btn').addEventListener('click', () => {
          document.getElementById('sidebar').classList.toggle('open');
          document.getElementById('sidebar-overlay').classList.toggle('open');
        });
        document.getElementById('sidebar-overlay').addEventListener('click', closeMobileSidebar);

        // Hash routing
        window.addEventListener('hashchange', () => switchTab(getTabFromHash()));
        switchTab(getTabFromHash());

        // Wire up buttons
        document.getElementById('trigger-build-btn').addEventListener('click', triggerBuild);
        document.getElementById('check-api-btn').addEventListener('click', checkAPI);
        document.getElementById('save-analytics-btn').addEventListener('click', () => saveConfig('analytics-status'));
        document.getElementById('save-seo-btn').addEventListener('click', () => saveConfig('seo-status'));
        document.getElementById('save-ads-btn').addEventListener('click', () => saveConfig('ads-status'));

        // Load data
        loadStats();
        checkAPI();
        loadBuildRuns();
        loadConfig();
      }

      // ── Data Functions ──
      async function loadStats() {
        const grid = document.getElementById('stats-grid');
        try {
          const res = await fetch('/search-index.json');
          const districts = res.ok ? await res.json() : [];
          const provinceCount = 81;
          const districtCount = districts.length;
          const periodCount = 6;
          const staticPages = 4;
          const provincePeriodPages = provinceCount * periodCount;
          const districtPeriodPages = districtCount * periodCount;
          const totalPages = provinceCount + districtCount + provincePeriodPages + districtPeriodPages + staticPages;
          const coveredProvinces = new Set(districts.map(d => {
            const parts = d.u.split('/');
            return parts[1];
          })).size;

          grid.innerHTML = '';
          const cards = [
            { label: 'Toplam Sayfa', value: totalPages.toLocaleString('tr-TR'), sub: `${provinceCount} il + ${districtCount} ilçe + ${(provincePeriodPages + districtPeriodPages).toLocaleString('tr-TR')} dönem + ${staticPages} statik` },
            { label: 'İl Sayısı', value: provinceCount, sub: `+ ${provincePeriodPages} dönem sayfası` },
            { label: 'İlçe Sayısı', value: districtCount, sub: `+ ${districtPeriodPages.toLocaleString('tr-TR')} dönem sayfası` },
            { label: 'İlçe Kapsam', value: coveredProvinces + '/81', sub: `${Math.round(coveredProvinces / 81 * 100)}% il kapsanıyor` }
          ];
          cards.forEach(c => {
            const card = document.createElement('div');
            card.className = 'stat-card';
            card.innerHTML = `<div class="stat-label">${sanitizeText(c.label)}</div><div class="stat-value">${sanitizeText(String(c.value))}</div><div class="stat-sub">${sanitizeText(c.sub)}</div>`;
            grid.appendChild(card);
          });
        } catch {
          grid.innerHTML = '<div style="color:#fca5a5;font-size:0.8125rem;">İstatistikler yüklenemedi.</div>';
        }
      }

      async function checkAPI() {
        const el = document.getElementById('api-status');
        if (!el) return;
        el.textContent = 'Kontrol ediliyor...';
        el.className = 'badge badge-warn';
        try {
          const start = Date.now();
          const res = await fetch('https://api.open-meteo.com/v1/forecast?latitude=41&longitude=29&current=temperature_2m');
          const ms = Date.now() - start;
          if (res.ok) {
            el.textContent = 'Aktif (' + ms + 'ms)';
            el.className = 'badge badge-ok';
          } else {
            el.textContent = 'Hata: ' + res.status;
            el.className = 'badge badge-error';
          }
        } catch {
          el.textContent = 'Bağlantı hatası';
          el.className = 'badge badge-error';
        }
      }

      async function triggerBuild() {
        const btn = document.getElementById('trigger-build-btn');
        const el = document.getElementById('build-status');
        btn.disabled = true;
        el.textContent = 'Tetikleniyor...';
        el.style.color = '#94a3b8';
        try {
          await ghApi(`/repos/${REPO_OWNER}/${REPO_NAME}/actions/workflows/${WORKFLOW_FILE}/dispatches`, {
            method: 'POST',
            body: JSON.stringify({ ref: WORKFLOW_BRANCH })
          });
          el.textContent = 'Build başarıyla tetiklendi!';
          el.style.color = '#34d399';
          setTimeout(() => loadBuildRuns(), 3000);
        } catch (err) {
          el.textContent = 'Tetiklenemedi: ' + err.message;
          el.style.color = '#fca5a5';
        }
        btn.disabled = false;
      }

      async function loadBuildRuns() {
        const container = document.getElementById('build-runs');
        if (!container) return;
        try {
          const data = await ghApi(`/repos/${REPO_OWNER}/${REPO_NAME}/actions/workflows/${WORKFLOW_FILE}/runs?per_page=5`);
          container.innerHTML = '';
          if (!data.workflow_runs || data.workflow_runs.length === 0) {
            container.innerHTML = '<div style="color:#64748b;font-size:0.8125rem;">Henüz build kaydı yok.</div>';
            return;
          }
          const statusMap = { success: 'Başarılı', failure: 'Başarısız', cancelled: 'İptal', in_progress: 'Devam ediyor', queued: 'Kuyrukta' };
          const triggerMap = { schedule: 'Otomatik', workflow_dispatch: 'Manuel', push: 'Push' };
          data.workflow_runs.forEach(run => {
            const item = document.createElement('div');
            item.className = 'build-run';
            const conclusion = run.conclusion || run.status;
            item.innerHTML = `<div class="run-dot ${sanitizeText(conclusion)}"></div><div class="run-info"><a href="${sanitizeText(run.html_url)}" target="_blank" rel="noopener">#${run.run_number}</a><span class="run-meta">${sanitizeText(statusMap[conclusion] || run.status)} (${sanitizeText(triggerMap[run.event] || run.event)})</span></div><span class="run-time">${new Date(run.created_at).toLocaleString('tr-TR')}</span>`;
            container.appendChild(item);
          });
        } catch {
          container.innerHTML = '<div style="color:#fca5a5;font-size:0.8125rem;">Build geçmişi yüklenemedi.</div>';
        }
      }

      // ── Config ──
      async function loadConfig() {
        try {
          const data = await ghApi(`/repos/${REPO_OWNER}/${REPO_NAME}/contents/${CONFIG_PATH}`);
          currentConfig = JSON.parse(atob(data.content));
          currentConfigSha = data.sha;
          populateFields(currentConfig);
          setSaveButtonsEnabled(true);
        } catch (err) {
          console.error('Config yüklenemedi:', err);
          ['analytics-status', 'seo-status', 'ads-status'].forEach(id => {
            const el = document.getElementById(id);
            if (el) { el.textContent = 'Config yüklenemedi'; el.style.color = '#fca5a5'; }
          });
        }
      }

      function populateFields(c) {
        const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v || ''; };
        set('cfg-ga', c.analytics?.googleAnalyticsId);
        set('cfg-ym', c.analytics?.yandexMetricaId);
        set('cfg-vg', c.verification?.google);
        set('cfg-vy', c.verification?.yandex);
        set('cfg-vb', c.verification?.bing);
        const adsEnabled = document.getElementById('cfg-ads-enabled');
        if (adsEnabled) adsEnabled.checked = !!c.ads?.enabled;
        set('cfg-ads-pub', c.ads?.adsensePublisherId);
        set('cfg-ads-header', c.ads?.adsenseSlots?.header);
        set('cfg-ads-sidebar', c.ads?.adsenseSlots?.sidebar);
        set('cfg-ads-incontent', c.ads?.adsenseSlots?.inContent);
        set('cfg-ads-footer', c.ads?.adsenseSlots?.footer);
      }

      function collectConfig() {
        return {
          analytics: {
            googleAnalyticsId: document.getElementById('cfg-ga').value.trim(),
            yandexMetricaId: document.getElementById('cfg-ym').value.trim()
          },
          verification: {
            google: document.getElementById('cfg-vg').value.trim(),
            yandex: document.getElementById('cfg-vy').value.trim(),
            bing: document.getElementById('cfg-vb').value.trim()
          },
          ads: {
            enabled: document.getElementById('cfg-ads-enabled').checked,
            provider: document.getElementById('cfg-ads-pub').value.trim() ? 'adsense' : '',
            adsensePublisherId: document.getElementById('cfg-ads-pub').value.trim(),
            adsenseSlots: {
              header: document.getElementById('cfg-ads-header').value.trim(),
              sidebar: document.getElementById('cfg-ads-sidebar').value.trim(),
              inContent: document.getElementById('cfg-ads-incontent').value.trim(),
              footer: document.getElementById('cfg-ads-footer').value.trim()
            }
          }
        };
      }

      async function saveConfig(statusElId) {
        if (!currentConfigSha) return;
        const el = document.getElementById(statusElId);
        setSaveButtonsEnabled(false);
        if (el) { el.textContent = 'Kaydediliyor...'; el.style.color = '#94a3b8'; }
        try {
          const newConfig = collectConfig();
          const content = btoa(unescape(encodeURIComponent(JSON.stringify(newConfig, null, 2) + '\n')));
          const result = await ghApi(`/repos/${REPO_OWNER}/${REPO_NAME}/contents/${CONFIG_PATH}`, {
            method: 'PUT',
            body: JSON.stringify({ message: 'chore: update site config via admin panel', content, sha: currentConfigSha })
          });
          currentConfigSha = result.content.sha;
          currentConfig = newConfig;
          try {
            await ghApi(`/repos/${REPO_OWNER}/${REPO_NAME}/actions/workflows/${WORKFLOW_FILE}/dispatches`, {
              method: 'POST',
              body: JSON.stringify({ ref: WORKFLOW_BRANCH })
            });
            if (el) { el.textContent = 'Kaydedildi ve build tetiklendi!'; el.style.color = '#34d399'; }
            setTimeout(() => loadBuildRuns(), 3000);
          } catch {
            if (el) { el.textContent = 'Kaydedildi ama build tetiklenemedi.'; el.style.color = '#fbbf24'; }
          }
        } catch (err) {
          if (el) { el.textContent = 'Kayıt hatası: ' + err.message; el.style.color = '#fca5a5'; }
        }
        setSaveButtonsEnabled(true);
      }

      // ── Login Modal ──
      document.getElementById('github-login-btn').addEventListener('click', (e) => {
        e.preventDefault();
        const overlay = document.createElement('div');
        overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.7);display:flex;align-items:center;justify-content:center;z-index:1000;';
        const modal = document.createElement('div');
        modal.style.cssText = 'background:#1e293b;border:1px solid #334155;border-radius:0.75rem;padding:2rem;max-width:480px;width:90%;';
        const title = document.createElement('h3');
        title.style.cssText = 'margin-bottom:0.75rem;font-size:1rem;';
        title.textContent = 'GitHub Personal Access Token';
        const desc = document.createElement('p');
        desc.style.cssText = 'font-size:0.8rem;color:#94a3b8;margin-bottom:1.25rem;line-height:1.6;';
        desc.textContent = 'GitHub → Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token. Gerekli izinler: Contents (read/write), Actions (read/write), Metadata (read).';
        const input = document.createElement('input');
        input.type = 'password';
        input.placeholder = 'github_pat_...';
        input.autocomplete = 'off';
        input.style.cssText = 'width:100%;padding:0.875rem 1rem;border-radius:0.5rem;border:1px solid #334155;background:#0f172a;color:white;font-size:0.875rem;margin-bottom:1.25rem;font-family:inherit;';
        const btnRow = document.createElement('div');
        btnRow.style.cssText = 'display:flex;gap:0.5rem;justify-content:flex-end;';
        const cancelBtn = document.createElement('button');
        cancelBtn.className = 'btn';
        cancelBtn.style.cssText = 'background:#334155;color:white;';
        cancelBtn.textContent = 'İptal';
        cancelBtn.addEventListener('click', () => overlay.remove());
        const okBtn = document.createElement('button');
        okBtn.className = 'btn btn-primary';
        okBtn.textContent = 'Giriş Yap';
        okBtn.addEventListener('click', () => {
          const token = input.value.trim();
          if (token) { sessionStorage.setItem(TOKEN_KEY, token); validateToken(token); }
          overlay.remove();
        });
        input.addEventListener('keydown', (ev) => {
          if (ev.key === 'Enter') okBtn.click();
          if (ev.key === 'Escape') overlay.remove();
        });
        btnRow.appendChild(cancelBtn);
        btnRow.appendChild(okBtn);
        modal.appendChild(title);
        modal.appendChild(desc);
        modal.appendChild(input);
        modal.appendChild(btnRow);
        overlay.appendChild(modal);
        document.body.appendChild(overlay);
        input.focus();
      });

      // ── Init ──
      checkAuth();
