(() => {
  const reconciliationState = { division: '', tab: 'customers', status: null, records: null, loading: false };
  let renderTimer = null;

  const escapeValue = value => String(value ?? '')
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#039;');
  const countValue = value => Number(value || 0).toLocaleString('en-GB');
  const divisionName = code => ({ PLANYX: 'Planyx', PROFILE_CENTRE: 'Profile Centre' })[code] || code || '—';
  const formatDateValue = value => value ? new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : '—';
  const formatMoneyValue = (minor, currency = 'GBP') => {
    if (minor === null || minor === undefined || !Number.isFinite(Number(minor))) return '—';
    try { return new Intl.NumberFormat('en-GB', { style: 'currency', currency: String(currency || 'GBP').toUpperCase() }).format(Number(minor) / 100); }
    catch { return `${Number(minor) / 100} ${String(currency || '').toUpperCase()}`; }
  };
  const statusPill = value => `<span class="tag">${escapeValue(String(value || 'unknown').replaceAll('_', ' '))}</span>`;

  function routeIsStripe() {
    return location.hash.includes('stripe-control') || document.querySelector('#currentRouteLabel')?.textContent?.includes('Stripe Control');
  }

  function selectedConnectorStatus() {
    const reconciliation = reconciliationState.status?.reconciliation;
    if (!reconciliation) return null;
    if (!reconciliationState.division) return null;
    return reconciliation.connectors?.find(item => item.connector?.slug === reconciliationState.division) || null;
  }

  function currentCounts() {
    return selectedConnectorStatus()?.counts || reconciliationState.status?.reconciliation?.totals || {};
  }

  function currentFinancials() {
    const rows = selectedConnectorStatus()?.financials || reconciliationState.status?.reconciliation?.financials || [];
    return rows.find(row => String(row.currency).toUpperCase() === 'GBP') || rows[0] || { currency: 'GBP', gross_minor: 0, refunds_minor: 0, fees_minor: 0, net_minor: 0 };
  }

  function backfillState() {
    const connectors = selectedConnectorStatus() ? [selectedConnectorStatus()] : reconciliationState.status?.reconciliation?.connectors || [];
    const checkpoints = connectors.flatMap(item => item.checkpoints || []);
    const incomplete = checkpoints.filter(item => !Number(item.backfill_complete));
    const lastRuns = connectors.map(item => item.lastRun).filter(Boolean);
    return { incomplete, lastRuns };
  }

  function rows() {
    return reconciliationState.records?.[reconciliationState.tab] || [];
  }

  function emptyRow(columns, label) {
    return `<tr><td colspan="${columns}"><div class="stripe-reconciliation-empty">${escapeValue(label)}</div></td></tr>`;
  }

  function customerTable(data) {
    return `<table><thead><tr><th>Customer</th><th>Stripe customer</th><th>UCN</th><th>Balance</th><th>Delinquent</th><th>Division</th></tr></thead><tbody>${data.length ? data.map(row => `<tr>
      <td><strong>${escapeValue(row.customer_name || row.name || row.email || 'Unnamed customer')}</strong><small>${escapeValue(row.email || '')}</small></td>
      <td><span class="soc-code">${escapeValue(row.stripe_customer_id)}</span></td>
      <td>${escapeValue(row.customer_number || 'Not linked')}</td>
      <td>${formatMoneyValue(row.balance_minor, row.currency || 'GBP')}</td>
      <td>${row.delinquent ? statusPill('attention required') : statusPill('clear')}</td>
      <td>${escapeValue(divisionName(row.connector_code))}</td>
    </tr>`).join('') : emptyRow(6, 'No Stripe customers have been imported yet.')}</tbody></table>`;
  }

  function transactionTable(data) {
    return `<table><thead><tr><th>Date</th><th>Transaction</th><th>Description</th><th>Gross</th><th>Fee</th><th>Net</th><th>Status</th><th>Division</th></tr></thead><tbody>${data.length ? data.map(row => `<tr>
      <td>${formatDateValue(row.source_created_at)}</td>
      <td><strong>${escapeValue(String(row.transaction_type || '').replaceAll('_', ' '))}</strong><small>${escapeValue(row.stripe_transaction_id)}</small></td>
      <td>${escapeValue(row.description || row.reporting_category || '—')}</td>
      <td>${formatMoneyValue(row.amount_minor, row.currency)}</td>
      <td>${formatMoneyValue(row.fee_minor, row.currency)}</td>
      <td>${formatMoneyValue(row.net_minor, row.currency)}</td>
      <td>${statusPill(row.status)}</td>
      <td>${escapeValue(divisionName(row.connector_code))}</td>
    </tr>`).join('') : emptyRow(8, 'No Stripe balance transactions have been imported yet.')}</tbody></table>`;
  }

  function refundTable(data) {
    return `<table><thead><tr><th>Date</th><th>Customer</th><th>Refund</th><th>Amount</th><th>Status</th><th>Reason</th><th>Division</th></tr></thead><tbody>${data.length ? data.map(row => `<tr>
      <td>${formatDateValue(row.source_created_at)}</td>
      <td><strong>${escapeValue(row.customer_name || row.customer_number || 'Unlinked')}</strong><small>${escapeValue(row.charge_id || '')}</small></td>
      <td><span class="soc-code">${escapeValue(row.stripe_refund_id)}</span></td>
      <td>${formatMoneyValue(row.amount_minor, row.currency)}</td>
      <td>${statusPill(row.status)}</td>
      <td>${escapeValue(row.reason || row.failure_reason || '—')}</td>
      <td>${escapeValue(divisionName(row.connector_code))}</td>
    </tr>`).join('') : emptyRow(7, 'No refunds have been recorded.')}</tbody></table>`;
  }

  function disputeTable(data) {
    return `<table><thead><tr><th>Date</th><th>Customer</th><th>Dispute</th><th>Amount</th><th>Status</th><th>Reason</th><th>Evidence due</th><th>Division</th></tr></thead><tbody>${data.length ? data.map(row => `<tr>
      <td>${formatDateValue(row.source_created_at)}</td>
      <td><strong>${escapeValue(row.customer_name || row.customer_number || 'Unlinked')}</strong><small>${escapeValue(row.charge_id || '')}</small></td>
      <td><span class="soc-code">${escapeValue(row.stripe_dispute_id)}</span></td>
      <td>${formatMoneyValue(row.amount_minor, row.currency)}</td>
      <td>${statusPill(row.status)}</td>
      <td>${escapeValue(row.reason || '—')}</td>
      <td>${formatDateValue(row.evidence_due_by)}</td>
      <td>${escapeValue(divisionName(row.connector_code))}</td>
    </tr>`).join('') : emptyRow(8, 'No disputes have been recorded.')}</tbody></table>`;
  }

  function productTable(data) {
    return `<table><thead><tr><th>Product</th><th>Stripe product</th><th>Status</th><th>Default price</th><th>Updated</th><th>Division</th></tr></thead><tbody>${data.length ? data.map(row => `<tr>
      <td><strong>${escapeValue(row.name)}</strong><small>${escapeValue(row.description || '')}</small></td>
      <td><span class="soc-code">${escapeValue(row.stripe_product_id)}</span></td>
      <td>${statusPill(row.active && !row.deleted_at ? 'active' : 'inactive')}</td>
      <td>${escapeValue(row.default_price_id || '—')}</td>
      <td>${formatDateValue(row.source_updated_at || row.updated_at)}</td>
      <td>${escapeValue(divisionName(row.connector_code))}</td>
    </tr>`).join('') : emptyRow(6, 'No Stripe products have been imported yet.')}</tbody></table>`;
  }

  function priceTable(data) {
    return `<table><thead><tr><th>Product</th><th>Stripe price</th><th>Price</th><th>Billing</th><th>Status</th><th>Division</th></tr></thead><tbody>${data.length ? data.map(row => `<tr>
      <td><strong>${escapeValue(row.product_name || row.stripe_product_id || 'Unlinked product')}</strong></td>
      <td><span class="soc-code">${escapeValue(row.stripe_price_id)}</span><small>${escapeValue(row.lookup_key || row.nickname || '')}</small></td>
      <td>${formatMoneyValue(row.unit_amount_minor, row.currency)}</td>
      <td>${escapeValue(row.price_type === 'recurring' ? `${row.recurring_interval_count || 1} ${row.recurring_interval || 'period'}` : 'One-off')}</td>
      <td>${statusPill(row.active && !row.deleted_at ? 'active' : 'inactive')}</td>
      <td>${escapeValue(divisionName(row.connector_code))}</td>
    </tr>`).join('') : emptyRow(6, 'No Stripe prices have been imported yet.')}</tbody></table>`;
  }

  function renderTable() {
    const data = rows();
    if (reconciliationState.tab === 'transactions') return transactionTable(data);
    if (reconciliationState.tab === 'refunds') return refundTable(data);
    if (reconciliationState.tab === 'disputes') return disputeTable(data);
    if (reconciliationState.tab === 'products') return productTable(data);
    if (reconciliationState.tab === 'prices') return priceTable(data);
    return customerTable(data);
  }

  function renderPanel() {
    const page = document.querySelector('#viewRoot .soc-page');
    if (!page || !routeIsStripe()) return;
    document.querySelector('#stripeReconciliationPanel')?.remove();
    const counts = currentCounts();
    const finance = currentFinancials();
    const progress = backfillState();
    const canSync = typeof hasPermission !== 'function' || hasPermission('configuration:write');
    const lastCompleted = progress.lastRuns.map(item => item.completed_at).filter(Boolean).sort().at(-1);
    const panel = document.createElement('section');
    panel.id = 'stripeReconciliationPanel';
    panel.className = 'soc-panel stripe-reconciliation-panel';
    panel.innerHTML = `
      <div class="stripe-reconciliation-header">
        <div><h2>Stripe account data & reconciliation</h2><p>Historical account data is imported from Stripe, while signed webhooks record new activity immediately. Hourly reconciliation recovers anything delayed or missed.</p></div>
        ${canSync ? '<button class="button primary" data-stripe-recon-action="sync">Import & reconcile all data</button>' : ''}
      </div>
      ${progress.incomplete.length ? `<div class="stripe-reconciliation-notice"><strong>Historical backfill in progress.</strong> ${progress.incomplete.length} resource stream${progress.incomplete.length === 1 ? '' : 's'} still have older records to import. Run reconciliation again or allow the hourly automation to continue.</div>` : ''}
      <div class="stripe-reconciliation-metrics">
        <article class="stripe-reconciliation-metric"><span>Customers</span><strong>${countValue(counts.customers)}</strong><small>Stripe customer records</small></article>
        <article class="stripe-reconciliation-metric"><span>Transactions</span><strong>${countValue(counts.transactions)}</strong><small>Balance ledger entries</small></article>
        <article class="stripe-reconciliation-metric"><span>Gross payments</span><strong>${formatMoneyValue(finance.gross_minor, finance.currency)}</strong><small>Imported Stripe ledger</small></article>
        <article class="stripe-reconciliation-metric"><span>Refunded</span><strong>${formatMoneyValue(finance.refunds_minor, finance.currency)}</strong><small>${countValue(counts.refunds)} refund records</small></article>
        <article class="stripe-reconciliation-metric"><span>Stripe fees</span><strong>${formatMoneyValue(finance.fees_minor, finance.currency)}</strong><small>Account fees recorded</small></article>
        <article class="stripe-reconciliation-metric"><span>Net movement</span><strong>${formatMoneyValue(finance.net_minor, finance.currency)}</strong><small>All balance movements</small></article>
        <article class="stripe-reconciliation-metric"><span>Disputes</span><strong>${countValue(counts.disputes)}</strong><small>${countValue(counts.open_disputes)} currently open</small></article>
        <article class="stripe-reconciliation-metric"><span>Products</span><strong>${countValue(counts.products)}</strong><small>${countValue(counts.active_products)} active</small></article>
        <article class="stripe-reconciliation-metric"><span>Prices</span><strong>${countValue(counts.prices)}</strong><small>${countValue(counts.active_prices)} active</small></article>
        <article class="stripe-reconciliation-metric"><span>Last reconciliation</span><strong style="font-size:14px">${lastCompleted ? formatDateValue(lastCompleted) : 'Not run'}</strong><small>Automatic schedule: hourly</small></article>
      </div>
      <div class="stripe-reconciliation-toolbar">
        <div class="stripe-reconciliation-tabs" aria-label="Stripe division filter">
          <button class="${!reconciliationState.division ? 'active' : ''}" data-stripe-recon-action="division" data-division="">Both divisions</button>
          <button class="${reconciliationState.division === 'planyx' ? 'active' : ''}" data-stripe-recon-action="division" data-division="planyx">Planyx</button>
          <button class="${reconciliationState.division === 'profile-centre' ? 'active' : ''}" data-stripe-recon-action="division" data-division="profile-centre">Profile Centre</button>
        </div>
        <div class="stripe-reconciliation-tabs" aria-label="Stripe data type">
          ${[['customers','Customers'],['transactions','Transactions'],['refunds','Refunds'],['disputes','Disputes'],['products','Products'],['prices','Prices']].map(([key,label]) => `<button class="${reconciliationState.tab === key ? 'active' : ''}" data-stripe-recon-action="tab" data-tab="${key}">${label}</button>`).join('')}
        </div>
      </div>
      <div class="stripe-reconciliation-table">${renderTable()}</div>`;
    page.append(panel);
  }

  async function loadReconciliation() {
    if (!routeIsStripe() || reconciliationState.loading) return;
    reconciliationState.loading = true;
    try {
      const suffix = reconciliationState.division ? `?division=${encodeURIComponent(reconciliationState.division)}` : '';
      const [status, records] = await Promise.all([
        api('/api/integrations/stripe/status'),
        api(`/api/integrations/stripe/records${suffix}`)
      ]);
      reconciliationState.status = status;
      reconciliationState.records = records;
      renderPanel();
    } catch (error) {
      console.warn('Stripe reconciliation data could not be loaded', error);
    } finally {
      reconciliationState.loading = false;
    }
  }

  function scheduleRender(force = false) {
    clearTimeout(renderTimer);
    renderTimer = setTimeout(() => {
      if (!routeIsStripe()) {
        document.querySelector('#stripeReconciliationPanel')?.remove();
        return;
      }
      if (!force && document.querySelector('#stripeReconciliationPanel')) return;
      loadReconciliation();
    }, 220);
  }

  document.addEventListener('click', async event => {
    const target = event.target.closest('[data-stripe-recon-action]');
    if (!target) return;
    event.preventDefault();
    const action = target.dataset.stripeReconAction;
    if (action === 'tab') {
      reconciliationState.tab = target.dataset.tab || 'customers';
      return renderPanel();
    }
    if (action === 'division') {
      reconciliationState.division = target.dataset.division || '';
      reconciliationState.records = null;
      return loadReconciliation();
    }
    if (action === 'sync') {
      target.disabled = true;
      target.textContent = 'Importing Stripe data…';
      try {
        const body = { mode: 'full', ...(reconciliationState.division ? { division: reconciliationState.division } : {}) };
        const result = await api('/api/integrations/stripe/sync', { method: 'POST', body: JSON.stringify(body) });
        const partial = result.results?.some(item => item.partial);
        toast(partial ? 'Stripe backfill continued' : 'Stripe data reconciled', partial ? 'Older records remain and will continue on the next run.' : 'Customers, transactions and catalogue data are now up to date.', 'success');
        reconciliationState.status = null;
        reconciliationState.records = null;
        await loadReconciliation();
      } catch (error) {
        toast('Stripe reconciliation failed', error.message, 'error');
      } finally {
        target.disabled = false;
        target.textContent = 'Import & reconcile all data';
      }
    }
  }, true);

  window.addEventListener('hashchange', () => scheduleRender(true));
  const root = document.querySelector('#viewRoot');
  if (root) {
    new MutationObserver(() => {
      if (!routeIsStripe()) {
        document.querySelector('#stripeReconciliationPanel')?.remove();
        return;
      }
      if (!document.querySelector('#stripeReconciliationPanel')) scheduleRender();
    }).observe(root, { childList: true, subtree: true });
  }
  window.renderStripeReconciliation = loadReconciliation;
  scheduleRender(true);
})();
