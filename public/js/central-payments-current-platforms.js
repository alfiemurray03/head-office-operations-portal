(() => {
  const CURRENT_WEBSITES = Object.freeze([
    Object.freeze({
      name: 'JA Group Services Ltd',
      canonicalCode: 'JA_GROUP_SERVICES',
      aliases: Object.freeze(['JA_GROUP_SERVICES'])
    }),
    Object.freeze({
      name: 'Sousa Murray Domains',
      canonicalCode: 'SOUSA_MURRAY_DOMAINS',
      aliases: Object.freeze(['SOUSA_MURRAY_DOMAINS','JA_DOMAIN_HUB','SOUSA_MURRAY_SITES'])
    }),
    Object.freeze({
      name: 'Sousa Murray Planeia',
      canonicalCode: 'SOUSA_MURRAY_PLANEIA',
      aliases: Object.freeze(['SOUSA_MURRAY_PLANEIA','PLANYX'])
    }),
    Object.freeze({
      name: 'Sousa Murray Profiles',
      canonicalCode: 'SOUSA_MURRAY_PROFILES',
      aliases: Object.freeze(['SOUSA_MURRAY_PROFILES','PROFILE_CENTRE','PROFILE_CENTER','PROFILECENTRE'])
    }),
    Object.freeze({
      name: 'Sousa Murray eLearning',
      canonicalCode: 'SOUSA_MURRAY_ELEARNING',
      aliases: Object.freeze(['SOUSA_MURRAY_ELEARNING','APTENVO','COURSE_SELECT'])
    })
  ]);

  let platforms = [];
  let loading = false;
  let timer = null;

  const escapeHtml = value => String(value ?? '')
    .replaceAll('&','&amp;')
    .replaceAll('<','&lt;')
    .replaceAll('>','&gt;')
    .replaceAll('"','&quot;')
    .replaceAll("'",'&#039;');

  function routeIsPayments() {
    return location.hash.includes('/payments')
      || document.querySelector('#currentRouteLabel')?.textContent?.toLowerCase().includes('payment');
  }

  function websiteForCode(value) {
    const code = String(value || '').toUpperCase();
    return CURRENT_WEBSITES.find(website => website.aliases.includes(code)) || null;
  }

  function score(platform, website) {
    let value = Number(platform.active_credential_count || 0) * 100;
    if (String(platform.code || '').toUpperCase() === website.canonicalCode) value += 20;
    if (String(platform.status || '').toLowerCase() === 'active') value += 10;
    if (String(platform.health_status || '').toLowerCase() === 'operational') value += 5;
    return value;
  }

  function currentWebsiteRows() {
    return CURRENT_WEBSITES.map(website => {
      const candidates = platforms.filter(platform => website.aliases.includes(String(platform.code || '').toUpperCase()));
      if (!candidates.length) return null;
      candidates.sort((a,b) => score(b,website) - score(a,website));
      return { website, platform: candidates[0] };
    }).filter(Boolean);
  }

  function replaceOptions(select, placeholder) {
    if (!select) return;
    const previous = select.value;
    const rows = currentWebsiteRows();
    select.innerHTML = `<option value="">${escapeHtml(placeholder)}</option>${rows.map(({website,platform}) =>
      `<option value="${escapeHtml(platform.id)}">${escapeHtml(website.name)}</option>`
    ).join('')}`;
    if ([...select.options].some(option => option.value === previous)) select.value = previous;
  }

  function relabelOriginRows() {
    const heading = [...document.querySelectorAll('.central-payments-section-title h3')]
      .find(node => node.textContent.trim() === 'Authorised platform return origins');
    const table = heading?.closest('section')?.querySelector('table');
    if (!table) return;
    for (const row of table.querySelectorAll('tbody tr')) {
      const cell = row.querySelector('td');
      const codeNode = cell?.querySelector('small');
      const website = websiteForCode(codeNode?.textContent);
      if (!website) continue;
      const nameNode = cell.querySelector('strong');
      if (nameNode) nameNode.textContent = website.name;
      codeNode?.remove();
    }
  }

  function apply() {
    if (!routeIsPayments()) return;
    replaceOptions(document.querySelector('#centralConnectionForm select[name="platformId"]'), 'Select website');
    replaceOptions(document.querySelector('#centralOriginForm select[name="platformId"]'), 'Select platform');
    relabelOriginRows();
  }

  async function refreshPlatforms() {
    if (!routeIsPayments() || loading) return;
    loading = true;
    try {
      const result = typeof api === 'function'
        ? await api('/api/platforms')
        : await fetch('/api/platforms',{credentials:'same-origin'}).then(response => {
            if (!response.ok) throw new Error(`Platform register returned ${response.status}.`);
            return response.json();
          });
      platforms = Array.isArray(result?.platforms) ? result.platforms : [];
      apply();
    } catch (error) {
      console.warn('Current Central Payments website register could not be loaded', error);
    } finally {
      loading = false;
    }
  }

  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (!routeIsPayments()) return;
      if (!platforms.length) return refreshPlatforms();
      apply();
    }, 80);
  }

  window.addEventListener('hashchange', () => {
    platforms = [];
    schedule();
  });
  new MutationObserver(schedule).observe(document.body,{subtree:true,childList:true});
  schedule();
})();
