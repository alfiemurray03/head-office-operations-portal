/* Universal customer search-and-select control for every Head Office workflow. */
(() => {
  'use strict';

  const FIELD_SELECTOR = [
    'input[name="customerNumber"]',
    'input[name="customerId"]',
    'input[name="customer_id"]',
    'input[name="ucn"]',
    'input[data-customer-lookup]'
  ].join(',');
  const MINIMUM_QUERY_LENGTH = 2;
  const states = new WeakMap();
  let pickerSequence = 0;

  const normalise = value => String(value || '').trim();

  function customerValue(input, customer) {
    const explicit = normalise(input.dataset.customerValue).toLowerCase();
    if (explicit === 'number' || explicit === 'ucn') return customer.customer_number;
    if (explicit === 'id') return customer.id;
    const name = normalise(input.name).toLowerCase();
    return name.includes('number') || name === 'ucn' ? customer.customer_number : customer.id;
  }

  function resultDescription(customer) {
    return [
      customer.verified_email,
      customer.mobile,
      customer.customer_number ? `UCN ${customer.customer_number}` : '',
      customer.account_status ? `Account: ${String(customer.account_status).replaceAll('_', ' ')}` : ''
    ].filter(Boolean).join(' · ');
  }

  function setExpanded(state, expanded) {
    state.root.classList.toggle('is-open', expanded);
    state.search.setAttribute('aria-expanded', expanded ? 'true' : 'false');
    state.results.hidden = !expanded;
    if (!expanded) {
      state.activeIndex = -1;
      state.search.removeAttribute('aria-activedescendant');
    }
  }

  function setMessage(state, message, tone = '') {
    state.results.replaceChildren();
    const row = document.createElement('div');
    row.className = `customer-picker-message${tone ? ` ${tone}` : ''}`;
    row.textContent = message;
    state.results.append(row);
    state.options = [];
    setExpanded(state, true);
  }

  function clearSelection(state, keepQuery = false) {
    state.input.value = '';
    state.input.removeAttribute('data-selected-customer-id');
    state.input.removeAttribute('data-selected-customer-number');
    state.selected.hidden = true;
    state.selectedName.textContent = '';
    state.selectedMeta.textContent = '';
    if (!keepQuery) state.search.value = '';
    state.search.setCustomValidity('');
    state.input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function selectCustomer(state, customer, focus = true) {
    state.input.value = customerValue(state.input, customer);
    state.input.dataset.selectedCustomerId = customer.id;
    state.input.dataset.selectedCustomerNumber = customer.customer_number;
    state.search.value = customer.display_name || customer.verified_email || customer.customer_number;
    state.search.setCustomValidity('');
    state.selectedName.textContent = customer.display_name || 'Customer';
    state.selectedMeta.textContent = resultDescription(customer);
    state.selected.hidden = false;
    state.options = [];
    state.results.replaceChildren();
    setExpanded(state, false);
    state.input.dispatchEvent(new Event('change', { bubbles: true }));
    if (focus) state.search.focus({ preventScroll: true });
  }

  function optionButton(state, customer, index) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'customer-picker-option';
    button.id = `${state.id}-option-${index}`;
    button.setAttribute('role', 'option');
    button.setAttribute('aria-selected', 'false');

    const avatar = document.createElement('span');
    avatar.className = 'customer-picker-avatar';
    avatar.textContent = normalise(customer.initials) || normalise(customer.display_name).split(/\s+/).map(part => part[0]).slice(0, 2).join('').toUpperCase() || 'CU';

    const copy = document.createElement('span');
    copy.className = 'customer-picker-option-copy';
    const name = document.createElement('strong');
    name.textContent = customer.display_name || 'Unnamed customer';
    const details = document.createElement('small');
    details.textContent = resultDescription(customer);
    copy.append(name, details);

    const status = document.createElement('span');
    status.className = 'customer-picker-status';
    status.textContent = normalise(customer.security_status || 'clear').replaceAll('_', ' ');

    button.append(avatar, copy, status);
    button.addEventListener('click', () => selectCustomer(state, customer));
    return button;
  }

  function renderResults(state, customers) {
    state.results.replaceChildren();
    state.options = customers.map((customer, index) => optionButton(state, customer, index));
    if (!state.options.length) {
      setMessage(state, 'No customer matched that search. Try their full name, email address, mobile number or UCN.', 'empty');
      return;
    }
    state.results.append(...state.options);
    setExpanded(state, true);
  }

  function setActiveOption(state, index) {
    if (!state.options.length) return;
    const next = Math.max(0, Math.min(index, state.options.length - 1));
    state.options.forEach((option, optionIndex) => {
      const active = optionIndex === next;
      option.classList.toggle('is-active', active);
      option.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    state.activeIndex = next;
    state.search.setAttribute('aria-activedescendant', state.options[next].id);
    state.options[next].scrollIntoView({ block: 'nearest' });
  }

  async function searchCustomers(state, rawQuery, initialValue = '') {
    const query = normalise(rawQuery);
    if (query.length < MINIMUM_QUERY_LENGTH) {
      state.controller?.abort();
      state.options = [];
      state.results.replaceChildren();
      if (query) setMessage(state, 'Enter at least two characters to search the Universal Customer Register.');
      else setExpanded(state, false);
      return;
    }

    state.controller?.abort();
    state.controller = new AbortController();
    const requestNumber = ++state.requestNumber;
    setMessage(state, 'Searching the Universal Customer Register…', 'loading');

    try {
      if (typeof api !== 'function') throw new Error('Customer search is not ready.');
      const response = await api(`/api/customers?q=${encodeURIComponent(query)}&limit=8`, { signal: state.controller.signal });
      if (requestNumber !== state.requestNumber) return;
      const customers = Array.isArray(response.customers) ? response.customers : [];
      if (initialValue) {
        const exact = customers.find(customer => customer.id === initialValue || customer.customer_number === initialValue);
        if (exact) {
          selectCustomer(state, exact, false);
          return;
        }
        clearSelection(state, true);
        state.search.value = '';
        setMessage(state, 'The previously supplied customer reference could not be found. Search and select the customer again.', 'error');
        return;
      }
      renderResults(state, customers);
    } catch (error) {
      if (error?.name === 'AbortError') return;
      if (requestNumber !== state.requestNumber) return;
      setMessage(state, error?.message || 'Customer search could not be completed.', 'error');
    }
  }

  function queueSearch(state) {
    clearTimeout(state.timer);
    state.timer = setTimeout(() => searchCustomers(state, state.search.value), 240);
  }

  function createPicker(input) {
    if (!(input instanceof HTMLInputElement) || input.dataset.customerPickerEnhanced === 'true') return;
    input.dataset.customerPickerEnhanced = 'true';

    const host = input.closest('label.field') || input.parentElement;
    if (!host) return;
    const originalValue = normalise(input.value);
    const required = input.required;
    input.required = false;
    input.type = 'hidden';

    const heading = host.querySelector(':scope > span');
    if (heading && /customer|universal|ucn/i.test(heading.textContent || '')) heading.textContent = required ? 'Customer' : 'Customer (optional)';

    const id = `customer-picker-${++pickerSequence}`;
    const root = document.createElement('div');
    root.className = 'customer-picker';
    root.dataset.customerPicker = 'true';

    const searchShell = document.createElement('div');
    searchShell.className = 'customer-picker-search-shell';
    const icon = document.createElement('span');
    icon.className = 'customer-picker-search-icon';
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = '⌕';
    const search = document.createElement('input');
    search.type = 'search';
    search.className = 'customer-picker-search';
    search.autocomplete = 'off';
    search.spellcheck = false;
    search.placeholder = 'Search name, email, mobile number or UCN';
    search.setAttribute('role', 'combobox');
    search.setAttribute('aria-autocomplete', 'list');
    search.setAttribute('aria-expanded', 'false');
    search.setAttribute('aria-controls', `${id}-results`);
    search.required = required;
    const shortcut = document.createElement('span');
    shortcut.className = 'customer-picker-search-hint';
    shortcut.textContent = 'Search';
    searchShell.append(icon, search, shortcut);

    const selected = document.createElement('div');
    selected.className = 'customer-picker-selected';
    selected.hidden = true;
    const selectedIcon = document.createElement('span');
    selectedIcon.className = 'customer-picker-selected-icon';
    selectedIcon.textContent = '✓';
    selectedIcon.setAttribute('aria-hidden', 'true');
    const selectedCopy = document.createElement('span');
    selectedCopy.className = 'customer-picker-selected-copy';
    const selectedName = document.createElement('strong');
    const selectedMeta = document.createElement('small');
    selectedCopy.append(selectedName, selectedMeta);
    const clear = document.createElement('button');
    clear.type = 'button';
    clear.className = 'customer-picker-clear';
    clear.textContent = 'Change';
    selected.append(selectedIcon, selectedCopy, clear);

    const results = document.createElement('div');
    results.className = 'customer-picker-results';
    results.id = `${id}-results`;
    results.setAttribute('role', 'listbox');
    results.hidden = true;

    const help = document.createElement('small');
    help.className = 'customer-picker-help';
    help.textContent = 'Select the correct customer from the Universal Customer Register. Internal IDs are filled automatically.';

    root.append(searchShell, selected, results, help);
    host.insertBefore(root, input);

    const state = {
      id,
      input,
      root,
      search,
      selected,
      selectedName,
      selectedMeta,
      results,
      required,
      options: [],
      activeIndex: -1,
      requestNumber: 0,
      controller: null,
      timer: null
    };
    states.set(input, state);

    search.addEventListener('input', () => {
      clearSelection(state, true);
      queueSearch(state);
    });
    search.addEventListener('focus', () => {
      if (state.options.length) setExpanded(state, true);
      else if (normalise(search.value).length >= MINIMUM_QUERY_LENGTH && !input.value) queueSearch(state);
    });
    search.addEventListener('keydown', event => {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setActiveOption(state, state.activeIndex + 1);
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        setActiveOption(state, state.activeIndex <= 0 ? 0 : state.activeIndex - 1);
      } else if (event.key === 'Enter' && state.activeIndex >= 0 && state.options[state.activeIndex]) {
        event.preventDefault();
        state.options[state.activeIndex].click();
      } else if (event.key === 'Escape') {
        setExpanded(state, false);
      }
    });
    clear.addEventListener('click', () => {
      clearSelection(state);
      setExpanded(state, false);
      search.focus({ preventScroll: true });
    });

    if (originalValue) {
      search.value = originalValue;
      searchCustomers(state, originalValue, originalValue);
    }
  }

  function enhance(root = document) {
    if (root instanceof HTMLInputElement && root.matches(FIELD_SELECTOR)) createPicker(root);
    root.querySelectorAll?.(FIELD_SELECTOR).forEach(createPicker);
  }

  window.enhanceCustomerPickers = enhance;
  enhance(document);

  new MutationObserver(mutations => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node instanceof Element) enhance(node);
      }
    }
  }).observe(document.body, { childList: true, subtree: true });

  document.addEventListener('click', event => {
    for (const state of document.querySelectorAll('[data-customer-picker="true"].is-open')) {
      if (!state.contains(event.target)) {
        const input = state.parentElement?.querySelector(FIELD_SELECTOR);
        const pickerState = input ? states.get(input) : null;
        if (pickerState) setExpanded(pickerState, false);
      }
    }
  });

  document.addEventListener('submit', event => {
    const form = event.target;
    if (!(form instanceof HTMLFormElement)) return;
    let firstInvalid = null;
    form.querySelectorAll(FIELD_SELECTOR).forEach(input => {
      const state = states.get(input);
      if (!state) return;
      const typed = normalise(state.search.value);
      const selected = normalise(input.value);
      const invalid = (state.required && !selected) || (typed && !selected);
      state.search.setCustomValidity(invalid ? 'Search for the customer and select the correct record from the results.' : '');
      if (invalid && !firstInvalid) firstInvalid = state.search;
    });
    if (firstInvalid) {
      event.preventDefault();
      event.stopImmediatePropagation();
      firstInvalid.reportValidity();
      firstInvalid.focus({ preventScroll: true });
    }
  }, true);
})();
