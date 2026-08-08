(() => {
  const EXPECTED_SOUSA_MURRAY_COURSES = 272;
  const EXPECTED_HIGHFIELD_COURSES = 101;
  let scheduled = false;
  let loading = false;

  const esc = value => String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');

  function routeIsPayments() {
    return location.hash.includes('/payments')
      || document.querySelector('#currentRouteLabel')?.textContent?.toLowerCase().includes('payment');
  }

  function activePrices(product) {
    return (product?.prices || []).filter(price => String(price?.status || '').toLowerCase() === 'active');
  }

  function countActivePrices(products) {
    return products.reduce((total, product) => total + activePrices(product).length, 0);
  }

  function row(label, value, state = 'ok', detail = '') {
    return `<div class="central-payments-full-catalogue-row ${esc(state)}">
      <div><strong>${esc(label)}</strong>${detail ? `<small>${esc(detail)}</small>` : ''}</div>
      <span>${esc(value)}</span>
    </div>`;
  }

  async function enhance() {
    if (!routeIsPayments() || loading || typeof api !== 'function') return;
    const panel = document.querySelector('#centralPaymentsPanel');
    if (!panel) return;

    const card = [...panel.querySelectorAll('.central-payments-card')].find(item => {
      const title = item.querySelector('h3')?.textContent?.trim();
      return title === 'Standard live catalogue' || title === 'Central Payments catalogue status';
    });
    if (!card || card.dataset.fullCatalogueStatus === 'complete' || card.dataset.fullCatalogueStatus === 'loading') return;

    card.dataset.fullCatalogueStatus = 'loading';
    loading = true;
    try {
      const [catalogue, provision] = await Promise.all([
        api('/api/integrations/central-payments/catalogue'),
        api('/api/integrations/central-payments/provision'),
      ]);

      const products = (catalogue?.products || []).filter(product => String(product?.status || '').toLowerCase() === 'active');
      const ownCourses = products.filter(product => String(product?.productCode || '').startsWith('SME-COURSE-'));
      const highfieldCourses = products.filter(product => String(product?.productCode || '').startsWith('HF-COURSE-'));
      const standardProducts = products.filter(product => {
        const code = String(product?.productCode || '');
        return !code.startsWith('SME-COURSE-') && !code.startsWith('HF-COURSE-');
      });

      const ownPrices = countActivePrices(ownCourses);
      const highfieldPrices = countActivePrices(highfieldCourses);
      const standardPrices = countActivePrices(standardProducts);
      const allPrices = countActivePrices(products);
      const standardReady = Boolean(provision?.ready);
      const ownProductsReady = ownCourses.length === EXPECTED_SOUSA_MURRAY_COURSES;
      const highfieldProductsReady = highfieldCourses.length === EXPECTED_HIGHFIELD_COURSES;
      const highfieldPricesReady = highfieldPrices === EXPECTED_HIGHFIELD_COURSES;
      const productCatalogueReady = standardReady && ownProductsReady && highfieldProductsReady;

      const heading = card.querySelector('h3');
      if (heading) heading.textContent = 'Central Payments catalogue status';
      const description = card.querySelector(':scope > p');
      if (description) {
        description.textContent = 'Shows the standard platform catalogue and both eLearning course catalogues held in the approved Central Payments Stripe account. The standard provisioning control below manages standard platform prices only.';
      }

      const status = card.querySelector('.central-payments-catalogue-status');
      if (status) {
        status.innerHTML = `<div class="central-payments-full-catalogue">
          ${row(
            'Standard platform catalogue',
            `${Number(provision?.provisioned || 0)} / ${Number(provision?.total || 0)} prices ready`,
            standardReady ? 'ok' : 'warn',
            `${standardProducts.length.toLocaleString('en-GB')} active products · ${standardPrices.toLocaleString('en-GB')} active prices`,
          )}
          ${row(
            'Sousa Murray course products',
            `${ownCourses.length.toLocaleString('en-GB')} / ${EXPECTED_SOUSA_MURRAY_COURSES} products ready`,
            ownProductsReady ? 'ok' : 'warn',
            'Individual Sousa Murray eLearning courses delivered through the Sousa Murray LMS',
          )}
          ${row(
            'Sousa Murray course prices',
            `${ownPrices.toLocaleString('en-GB')} / ${EXPECTED_SOUSA_MURRAY_COURSES} prices approved`,
            ownPrices === EXPECTED_SOUSA_MURRAY_COURSES ? 'ok' : 'pending',
            ownPrices === EXPECTED_SOUSA_MURRAY_COURSES
              ? 'All individual course prices are active'
              : 'Individual course products are present; prices remain pending until the commercial pricing rule is approved',
          )}
          ${row(
            'Highfield course products',
            `${highfieldCourses.length.toLocaleString('en-GB')} / ${EXPECTED_HIGHFIELD_COURSES} products ready`,
            highfieldProductsReady ? 'ok' : 'warn',
            'Highfield Online Training courses sold through Sousa Murray eLearning',
          )}
          ${row(
            'Highfield course prices',
            `${highfieldPrices.toLocaleString('en-GB')} / ${EXPECTED_HIGHFIELD_COURSES} prices ready`,
            highfieldPricesReady ? 'ok' : 'warn',
            'Current one-off Highfield course prices available for website and manual sales',
          )}
          ${row(
            'Total governed Stripe catalogue',
            `${products.length.toLocaleString('en-GB')} active products · ${allPrices.toLocaleString('en-GB')} active prices`,
            productCatalogueReady ? 'ok' : 'warn',
            'Standard platform products + Sousa Murray courses + Highfield courses',
          )}
        </div>`;
      }

      const provisionButton = card.querySelector('[data-central-payment-action="provision-standard-catalogue"]');
      if (provisionButton) {
        provisionButton.textContent = standardReady ? 'Standard platform catalogue ready' : 'Provision standard platform catalogue';
      }

      let note = card.querySelector('[data-full-catalogue-note]');
      if (!note) {
        note = document.createElement('small');
        note.dataset.fullCatalogueNote = 'true';
        card.append(note);
      }
      note.textContent = 'Course products are synchronised from Sousa Murray eLearning. They are separate from the standard platform catalogue provision action.';

      const topBadge = [...panel.querySelectorAll('.central-payments-heading .central-payments-badge')]
        .find(item => item.textContent?.includes('Standard catalogue') || item.dataset.fullCatalogueBadge === 'true');
      if (topBadge) {
        topBadge.dataset.fullCatalogueBadge = 'true';
        topBadge.classList.toggle('ok', productCatalogueReady);
        topBadge.classList.toggle('warn', !productCatalogueReady);
        topBadge.textContent = `${productCatalogueReady ? '✓' : '!'} Product catalogue ${products.length.toLocaleString('en-GB')} products`;
      }

      card.dataset.fullCatalogueStatus = 'complete';
    } catch (error) {
      console.warn('Full Central Payments catalogue status could not be calculated', error);
      delete card.dataset.fullCatalogueStatus;
    } finally {
      loading = false;
    }
  }

  function schedule() {
    if (scheduled) return;
    scheduled = true;
    window.setTimeout(() => {
      scheduled = false;
      void enhance();
    }, 80);
  }

  window.addEventListener('hashchange', schedule);
  new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });
  schedule();
})();