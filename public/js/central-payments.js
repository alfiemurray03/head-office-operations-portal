(() => {
  const state = { loading: false, overview: null, catalogue: null, configuration: null, platforms: [] };
  let renderTimer = null;

  const esc = value => String(value ?? '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#039;');
  const money = (minor, currency='GBP') => Number.isFinite(Number(minor))
    ? new Intl.NumberFormat('en-GB',{style:'currency',currency:String(currency||'GBP').toUpperCase()}).format(Number(minor)/100)
    : '—';
  const date = value => value ? new Intl.DateTimeFormat('en-GB',{dateStyle:'medium',timeStyle:'short'}).format(new Date(value)) : '—';
  const canWrite = () => typeof hasPermission !== 'function' || hasPermission('payments:write');
  const routeIsPayments = () => location.hash.includes('/payments') || document.querySelector('#currentRouteLabel')?.textContent?.toLowerCase().includes('payment');

  function root() {
    return document.querySelector('#viewRoot .soc-page') || document.querySelector('#viewRoot');
  }

  function badge(label, ok) {
    return `<span class="central-payments-badge ${ok ? 'ok':'warn'}">${ok ? '✓':'!'} ${esc(label)}</span>`;
  }

  function productOptions() {
    return (state.catalogue?.products || []).map(product => `<option value="${esc(product.productCode)}">${esc(product.brandCode)} · ${esc(product.productCode)} · ${esc(product.name)}</option>`).join('');
  }

  function platformOptions() {
    return state.platforms.map(platform => `<option value="${esc(platform.id)}">${esc(platform.name)} · ${esc(platform.code)}</option>`).join('');
  }

  function catalogueRows() {
    const products = state.catalogue?.products || [];
    if (!products.length) return '<div class="central-payments-empty">No Central Payments products have been created yet.</div>';
    const rows = products.flatMap(product => product.prices.length ? product.prices.map(price => ({product,price})) : [{product,price:null}]);
    return `<table><thead><tr><th>Brand / product</th><th>Price code</th><th>Amount</th><th>Billing</th><th>Stripe references</th></tr></thead><tbody>${rows.map(({product,price}) => `<tr>
      <td><strong>${esc(product.name)}</strong><small>${esc(product.brandCode)} · ${esc(product.productCode)}</small></td>
      <td>${price ? `<span class="central-payments-code">${esc(price.priceCode)}</span>` : '—'}</td>
      <td>${price ? money(price.amountMinor,price.currency) : '—'}</td>
      <td>${price ? esc(price.billingType === 'recurring' ? `${price.recurringIntervalCount||1} ${price.recurringInterval||'period'}` : 'One-off') : '—'}</td>
      <td><span class="central-payments-code">${esc(product.stripeProductId||'—')}</span>${price ? `<small class="central-payments-code">${esc(price.stripePriceId)}</small>`:''}</td>
    </tr>`).join('')}</tbody></table>`;
  }

  function originRows() {
    const rows = state.configuration?.platformOrigins || [];
    if (!rows.length) return '<div class="central-payments-empty">No brand return origins are authorised yet.</div>';
    return `<table><thead><tr><th>Platform</th><th>Authorised HTTPS origin</th><th>Status</th><th></th></tr></thead><tbody>${rows.map(row => `<tr>
      <td><strong>${esc(row.platform_name)}</strong><small>${esc(row.platform_code)}</small></td>
      <td><span class="central-payments-code">${esc(row.origin)}</span></td>
      <td>${esc(row.status)}</td>
      <td>${canWrite() && row.status === 'active' ? `<button class="button secondary" data-central-payment-action="remove-origin" data-platform-id="${esc(row.platform_id)}" data-origin="${esc(row.origin)}">Revoke</button>`:''}</td>
    </tr>`).join('')}</tbody></table>`;
  }

  function checkoutRows() {
    const rows = state.overview?.recentCheckoutRequests || [];
    if (!rows.length) return '<div class="central-payments-empty">No central checkout requests have been created yet.</div>';
    return `<table><thead><tr><th>Created</th><th>Customer</th><th>Brand / product</th><th>Order</th><th>Amount</th><th>Status</th></tr></thead><tbody>${rows.map(row => `<tr>
      <td>${date(row.created_at)}</td><td><span class="central-payments-code">${esc(row.customer_number)}</span></td>
      <td><strong>${esc(row.brand_code)}</strong><small>${esc(row.product_code)} · ${esc(row.price_code)}</small></td>
      <td>${esc(row.order_reference||row.service_reference||'—')}</td><td>${money(row.amount_minor,row.currency)}</td><td>${esc(row.status)}</td>
    </tr>`).join('')}</tbody></table>`;
  }

  function render() {
    if (!routeIsPayments()) return document.querySelector('#centralPaymentsPanel')?.remove();
    const target = root();
    if (!target || !state.overview || !state.configuration || !state.catalogue) return;
    document.querySelector('#centralPaymentsPanel')?.remove();
    const config = state.overview.configuration || {};
    const account = state.configuration.stripeAccount;
    const metrics = state.overview.metrics || {};
    const panel = document.createElement('section');
    panel.id = 'centralPaymentsPanel';
    panel.className = 'soc-panel central-payments-panel';
    panel.innerHTML = `
      <div class="central-payments-heading">
        <div><p class="eyebrow">JA Group Services Ltd · Head Office</p><h2>Central Payments</h2><p>One governed payment service for Sousa Murray websites. Head Office owns the Stripe connection, customer link, product catalogue, checkout creation, webhook processing and routed payment status.</p></div>
        <div class="central-payments-badges">
          ${badge('Service enabled',config.enabled)}
          ${badge('Central Stripe key',config.stripeKeyConfigured)}
          ${badge('Webhook signing',config.stripeWebhookConfigured)}
          ${badge('Approved account',Boolean(account?.id) && !state.configuration.stripeError)}
          ${badge(String(config.mode||'unknown').toUpperCase()+' mode',config.mode==='live')}
        </div>
      </div>
      ${state.configuration.stripeError ? `<div class="central-payments-notice central-payments-error"><strong>Stripe account check failed.</strong> ${esc(state.configuration.stripeError.message)}</div>`:''}
      <div class="central-payments-metrics">
        <article class="central-payments-metric"><span>Linked customers</span><strong>${Number(metrics.linked_customers||0).toLocaleString('en-GB')}</strong></article>
        <article class="central-payments-metric"><span>Active products</span><strong>${Number(metrics.active_products||0).toLocaleString('en-GB')}</strong></article>
        <article class="central-payments-metric"><span>Active prices</span><strong>${Number(metrics.active_prices||0).toLocaleString('en-GB')}</strong></article>
        <article class="central-payments-metric"><span>Open checkouts</span><strong>${Number(metrics.open_checkouts||0).toLocaleString('en-GB')}</strong></article>
        <article class="central-payments-metric"><span>Subscriptions</span><strong>${Number(metrics.active_subscriptions||0).toLocaleString('en-GB')}</strong></article>
        <article class="central-payments-metric"><span>Pending platform events</span><strong>${Number(metrics.pending_platform_events||0).toLocaleString('en-GB')}</strong></article>
      </div>
      <div class="central-payments-notice"><strong>Central Stripe account:</strong> ${account ? `${esc(account.businessName||'JA Group Services Ltd')} · <span class="central-payments-code">${esc(account.id)}</span> · ${account.chargesEnabled?'charges enabled':'charges not enabled'}` : 'Waiting for CENTRAL_STRIPE_SECRET_KEY and CENTRAL_STRIPE_ACCOUNT_ID.'}<br><strong>Webhook endpoint:</strong> <span class="central-payments-code">${esc(config.webhookEndpoint||'/api/webhooks/stripe')}</span></div>
      ${canWrite() ? `<div class="central-payments-grid">
        <section class="central-payments-card"><h3>Create central product</h3><p>Creates the Stripe Product in the approved Central Payments account and records the Head Office product code.</p><form id="centralProductForm" class="central-payments-form two">
          <label>Brand<select name="brandCode" required>${(state.configuration.brands||[]).map(brand => `<option value="${esc(brand.code)}">${esc(brand.name)}</option>`).join('')}</select></label>
          <label>Product code<input name="productCode" placeholder="ELEARNING_LIBRARY" required></label>
          <label class="full">Public product name<input name="name" required></label>
          <label class="full">Description<textarea name="description"></textarea></label>
          <label>Service type<input name="serviceType" value="service"></label>
          <div class="central-payments-actions"><button class="button primary" type="submit">Create product</button></div>
        </form></section>
        <section class="central-payments-card"><h3>Create central price</h3><p>Brand websites will request this Head Office price code rather than sending raw Stripe Price IDs.</p><form id="centralPriceForm" class="central-payments-form two">
          <label class="full">Product<select name="productCode" required><option value="">Select product</option>${productOptions()}</select></label>
          <label>Price code<input name="priceCode" placeholder="MONTHLY" required></label>
          <label>Amount (£)<input name="amount" type="number" min="0" step="0.01" required></label>
          <label>Billing<select name="billingType"><option value="one_time">One-off</option><option value="recurring">Recurring</option></select></label>
          <label>Interval<select name="recurringInterval"><option value="month">Month</option><option value="year">Year</option><option value="week">Week</option></select></label>
          <div class="central-payments-actions"><button class="button primary" type="submit">Create price</button></div>
        </form></section>
        <section class="central-payments-card"><h3>Authorise brand return origin</h3><p>Checkout and billing portal returns are refused unless Head Office has authorised the exact HTTPS origin.</p><form id="centralOriginForm" class="central-payments-form">
          <label>Connected platform<select name="platformId" required><option value="">Select platform</option>${platformOptions()}</select></label>
          <label>HTTPS origin<input name="origin" type="url" placeholder="https://service.jagroupservices.co.uk" required></label>
          <div class="central-payments-actions"><button class="button primary" type="submit">Authorise origin</button></div>
        </form></section>
        <section class="central-payments-card"><h3>Required Stripe webhook events</h3><p>The single Central Payments webhook should subscribe to these lifecycle events.</p><div class="central-payments-code">${(state.configuration.requiredWebhookEvents||[]).map(esc).join('<br>')}</div></section>
      </div>`:''}
      <section><div class="central-payments-section-title"><div><h3>Central product & price catalogue</h3><p>Company-wide product codes mapped to the approved Stripe account.</p></div></div><div class="central-payments-table">${catalogueRows()}</div></section>
      <section><div class="central-payments-section-title"><div><h3>Authorised platform return origins</h3><p>Only these websites may receive customers back from Central Payments.</p></div></div><div class="central-payments-table">${originRows()}</div></section>
      <section><div class="central-payments-section-title"><div><h3>Recent central checkout requests</h3><p>Checkouts created by connected Sousa Murray platforms.</p></div><button class="button secondary" data-central-payment-action="refresh">Refresh</button></div><div class="central-payments-table">${checkoutRows()}</div></section>`;
    target.append(panel);
  }

  async function load() {
    if (!routeIsPayments() || state.loading) return;
    state.loading = true;
    try {
      const [overview,catalogue,configuration,platforms] = await Promise.all([
        api('/api/integrations/central-payments/overview'),
        api('/api/integrations/central-payments/catalogue'),
        api('/api/integrations/central-payments/configuration'),
        api('/api/platforms')
      ]);
      state.overview=overview; state.catalogue=catalogue; state.configuration=configuration; state.platforms=platforms.platforms||[];
      render();
    } catch (error) {
      console.warn('Central Payments workspace could not be loaded',error);
      const target=root();
      if(target && routeIsPayments()){
        document.querySelector('#centralPaymentsPanel')?.remove();
        const panel=document.createElement('section'); panel.id='centralPaymentsPanel'; panel.className='soc-panel central-payments-panel';
        panel.innerHTML=`<div class="central-payments-notice central-payments-error"><strong>Central Payments could not load.</strong> ${esc(error.message||'Please try again.')}</div>`;
        target.append(panel);
      }
    } finally { state.loading=false; }
  }

  async function post(url,body){ return api(url,{method:'POST',body:JSON.stringify(body)}); }

  document.addEventListener('submit',async event=>{
    if(event.target.id==='centralProductForm'){
      event.preventDefault(); const form=new FormData(event.target); const button=event.target.querySelector('button[type="submit"]'); button.disabled=true;
      try{await post('/api/integrations/central-payments/catalogue',{action:'createProduct',brandCode:form.get('brandCode'),productCode:form.get('productCode'),name:form.get('name'),description:form.get('description'),serviceType:form.get('serviceType')}); toast?.('Central product created','The product is now governed by Head Office Central Payments.','success'); await loadFresh();}
      catch(error){toast?.('Central product was not created',error.message||'Please try again.','error');} finally{button.disabled=false;}
    }
    if(event.target.id==='centralPriceForm'){
      event.preventDefault(); const form=new FormData(event.target); const button=event.target.querySelector('button[type="submit"]'); button.disabled=true;
      try{await post('/api/integrations/central-payments/catalogue',{action:'createPrice',productCode:form.get('productCode'),priceCode:form.get('priceCode'),amountMinor:Math.round(Number(form.get('amount'))*100),currency:'GBP',billingType:form.get('billingType'),recurringInterval:form.get('recurringInterval'),taxBehavior:'inclusive'}); toast?.('Central price created','Brand websites can now request this Head Office price code.','success'); await loadFresh();}
      catch(error){toast?.('Central price was not created',error.message||'Please try again.','error');} finally{button.disabled=false;}
    }
    if(event.target.id==='centralOriginForm'){
      event.preventDefault(); const form=new FormData(event.target); const button=event.target.querySelector('button[type="submit"]'); button.disabled=true;
      try{await post('/api/integrations/central-payments/configuration',{action:'addOrigin',platformId:form.get('platformId'),origin:form.get('origin')}); toast?.('Return origin authorised','Central Payments can now return customers to that platform origin.','success'); await loadFresh();}
      catch(error){toast?.('Origin was not authorised',error.message||'Please try again.','error');} finally{button.disabled=false;}
    }
  });

  document.addEventListener('click',async event=>{
    const target=event.target.closest('[data-central-payment-action]'); if(!target)return;
    const action=target.dataset.centralPaymentAction;
    if(action==='refresh'){event.preventDefault();return loadFresh();}
    if(action==='remove-origin'){
      event.preventDefault(); target.disabled=true;
      try{await post('/api/integrations/central-payments/configuration',{action:'removeOrigin',platformId:target.dataset.platformId,origin:target.dataset.origin}); toast?.('Return origin revoked','The platform can no longer use that origin for payment returns.','success'); await loadFresh();}
      catch(error){toast?.('Origin was not revoked',error.message||'Please try again.','error');} finally{target.disabled=false;}
    }
  });

  async function loadFresh(){ state.overview=null;state.catalogue=null;state.configuration=null; await load(); }
  function schedule(){
    clearTimeout(renderTimer);
    renderTimer=setTimeout(()=>{
      if(!routeIsPayments()) return document.querySelector('#centralPaymentsPanel')?.remove();
      if(document.querySelector('#centralPaymentsPanel')) return;
      if(state.overview && state.catalogue && state.configuration) return render();
      load();
    },180);
  }
  window.addEventListener('hashchange',()=>{state.overview=null;state.catalogue=null;state.configuration=null;schedule();});
  new MutationObserver(schedule).observe(document.body,{subtree:true,childList:true});
  schedule();
})();